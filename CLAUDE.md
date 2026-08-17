# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vela Core is the backend API for **Vela**, a multi-tenant SaaS platform built as a portfolio piece aimed at recruiters and technical evaluators. It exists to demonstrate a production-grade multi-tenant backend end to end: tenant-scoped data isolation, three-tier RBAC, white-label branding, and defensive API design. When adding features, prefer the option that makes the multi-tenancy story clearer over one that merely adds surface area.

The frontend lives in the sibling repo **vela-ui** (React 19, deployed on Vercel); this API deploys on Render. The two repos share a contract (see "Cross-repo contract" below).

**Write everything in English** — code, comments, commit messages, API responses, seed/fixture data (it's recruiter-visible).

## Tech stack

- **Runtime:** Node.js 20+, TypeScript, ESM (`NodeNext`)
- **HTTP framework:** Fastify 5 (helmet, cors, cookie, multipart, sensible, jwt, swagger)
- **ORM:** Prisma 7 with `@prisma/adapter-pg` against PostgreSQL (Neon in production). The generated client is checked in at `src/generated/prisma` — never edit it by hand; change `prisma/schema.prisma` and run `npx prisma generate`.
- **Validation:** Zod 4 via `fastify-type-provider-zod` — route schemas double as OpenAPI documentation.
- **Auth:** `@fastify/jwt` signing an httpOnly `token` cookie (the `Authorization` header is deliberately not accepted — see `verify.onlyCookie` in `src/lib/auth.ts`). Passwords hashed with bcryptjs.
- **Testing:** Vitest integration tests (`src/tests/`) that exercise the real HTTP surface via `app.inject` against a real Postgres, with only S3 mocked.

## Commands

```bash
# install deps (also runs `prisma generate` via postinstall)
npm install

# apply the database schema
npx prisma migrate dev

# seed an admin/guest user and a demo tenant
npx prisma db seed

# start the dev server (hot reload, tsx watch) on http://localhost:3010
npm run dev

# run the full test suite (Vitest, against DATABASE_URL)
npm test

# run a single test file / a filtered set of tests
npx vitest run src/tests/tenant.routes.spec.ts
npx vitest run -t "some test name"

# run tests with a coverage report (100% threshold enforced, see vitest.config.ts)
npm run test:coverage

# lint (eslint flat config, typescript-eslint typeChecked + prettier) and format
npm run lint
npm run format

# type-check only (tsconfig.json covers everything, including tests)
npx tsc --noEmit

# type-check + build for production (tsconfig.build.json excludes tests)
npm run build
npm start

# run API + Postgres together in Docker (migrate deploy runs automatically on boot)
docker compose up -d --build
```

Copy `.env.example` to `.env` before running anything locally; `DATABASE_URL` and `JWT_SECRET` are always required, AWS S3 vars are required only for logo uploads, and `FRONTEND_URL` is required when `NODE_ENV=production`.

Interactive API docs (Swagger UI) are served at `GET /docs` once the server is running; the raw OpenAPI spec is at `GET /docs/json`. Swagger UI's "Try it out" can't set the httpOnly cookie, so exercise protected routes via a real HTTP client after `POST /api/auth/login`.

## Architecture: Routes → Services → Prisma

- **Routes (`src/routes/*.routes.ts`) only do HTTP.** They parse/validate the request (Zod schemas that double as Swagger metadata), call a service, and map the result to a reply. A route handler with an `if` that encodes a business rule is a code smell — move it down to a service.
- **Services (`src/services/*.service.ts`) own the business rules:** tenant creation limits, slug conflicts, RBAC tenant scoping, credential checks, dashboard aggregation. Services never touch `reply` or set status codes; they signal failure by throwing.
- **Domain errors (`src/services/errors.ts`):** services throw typed `DomainError` subclasses (`NotFoundError`, `ConflictError`, `ForbiddenError`, `BadRequestError`, `TenantHasUsersError`). The central error handler (`src/lib/errorHandler.ts`) translates them to HTTP in one place. `TenantHasUsersError` is the template for machine-readable errors: it overrides `toResponse()` to include `userCount`, because vela-ui switches on the literal `TENANT_HAS_USERS` string to drive its double-confirmation cascade-delete dialog. Only add a similar override when the frontend actually branches on the payload.
- **`src/lib/`** is HTTP/infra plumbing, not business logic: the auth plugin (`auth.ts`), error handler, Prisma client singleton, S3 upload helper, multipart parsing, swagger setup, shared response schemas.
- **No repository-interface layer on top of Prisma.** One database, no variation axis — the ORM already is the abstraction. Don't add `ITenantRepository`-style ceremony.
- **`src/app.ts`** wires up the Fastify instance (plugin registration order matters — CORS/helmet/cookie/multipart/sensible/auth before routes, swagger before routes so its `onRoute` hook captures every endpoint) and is imported by `src/server.ts`, which just binds it to `0.0.0.0:$PORT` (must be `0.0.0.0`, not loopback, or cloud platform health checks fail).

## Multi-tenancy model (the heart of this repo)

Shared database, shared schema. Every `User` belongs to exactly one `Tenant` via `tenantId` (FK, `ON DELETE CASCADE`).

- **Roles**, in `prisma/schema.prisma` as a Postgres enum: `VELA_ADMIN` (platform root, sees across every tenant) > `ADMIN` (manages one tenant) > `MEMBER` (read-only within their tenant). `VELA_ADMIN` must pass every check `ADMIN` passes — a root role that fails an admin-only route is a regression. There is no API route to promote a user; `VELA_ADMIN`/`ADMIN` are only ever set via `prisma/seed.ts` or direct database access.
- **Isolation is enforced at the query level, inside services** — not via middleware or a repository layer. E.g. `listUsers` scopes `where: { tenantId }` for anyone below `VELA_ADMIN`; `createUser` overwrites any client-supplied `tenantId` with the caller's own when the caller is a tenant `ADMIN`. Never trust a tenant identifier from the request body for a non-root caller.
- **Self-registration (`POST /api/auth/register`) is always `MEMBER`.** The endpoint is public and tenant ids are enumerable via `GET /api/tenants/public`, so honoring a client-supplied role would let anyone self-assign `ADMIN`.
- **White-label:** `GET /api/tenants/:slug` is public so vela-ui can fetch a tenant's branding (`name`, `primaryColor`, `logoUrl`) before login.
- **Demo safeguard:** `MAX_TENANTS_LIMIT` in `tenant.service.ts` caps tenant creation to protect the free-tier database. Keep it above whatever the test suite creates in one run.

## Security invariants

- JWT lives only in an httpOnly `token` cookie; production sets `Secure` + `SameSite=None` (needed because Vercel↔Render is cross-site), dev keeps `SameSite=Lax`. Logout must clear the cookie with the exact same attributes it was set with (`getAuthCookieOptions` in `auth.routes.ts`).
- CORS origin comes from `FRONTEND_URL` (comma-separated for multiple origins); the app refuses to start in production without it. Never introduce a wildcard origin.
- Login returns one generic 401 for both "unknown email" and "wrong password" (no user enumeration).
- Logo uploads must be image mimetypes; S3 objects get no ACL (bucket policy grants public read — object ACLs are disabled by default on buckets created since April 2023).
- All secrets come from `process.env`; `.env.example` is the only env file that may be committed. The husky pre-commit hook runs secretlint via lint-staged — if it flags a false positive, fix the pattern or add a scoped `secretlint-disable`, never `--no-verify`.

## Testing & quality gates

- `npm test` runs Vitest against the database in `DATABASE_URL`; tests seed via `src/tests/helpers.ts` and clean up after themselves.
- `vitest.config.ts` enforces a **100% coverage threshold** (lines, functions, branches, statements) — CI fails if any metric drops below that.
- New business logic goes in a service and gets exercised through a route-level integration test, keeping coverage meaningful (behavior, not implementation).
- Three GitHub Actions workflows run on every push/PR to `main`/`develop`: `ci.yml` (lint, `tsc --noEmit`, build), `tests.yml` (ephemeral Postgres 15 service, migrate + seed + full test suite with coverage uploaded to Codecov), `security.yml` (`npm audit --audit-level=high` + secretlint sweep, also on a weekly cron).

## Version control

- **Gitflow:** `main` (production) / `develop` (integration) / `feature/*`, `bugfix/*`, `chore/*` branching off `develop`.
- **Conventional Commits, in English, always** (`feat(api):`, `fix(api):`, `refactor(api):`, `chore(api):`, `docs:`, `test:`). Each PR is one atomic change, squash-merged with a clean final message.
- When committing, branch off first — never commit directly to `main`.

## Cross-repo contract with vela-ui

- Error codes/shapes the frontend branches on (`TENANT_HAS_USERS`, the `scope` discriminant in `GET /api/metrics/dashboard`) are a cross-repo contract — changing them means changing vela-ui in the same milestone.
- The checked-in `swagger.json` in vela-ui's repo root mirrors this API's OpenAPI output; regenerate it after changing any route's shape.
- Database changes always go through an explicit Prisma migration (`npx prisma migrate dev --name <change>`) — never `db push` against a shared environment.
