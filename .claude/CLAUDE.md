# Vela Core - System Context & AI Agent Rules

## 🎯 Project Objective
Vela is a **multi-tenant SaaS platform** built as a portfolio piece whose explicit audience is recruiters and technical evaluators. Everything in this repo exists to demonstrate, end to end, how a production-grade multi-tenant backend is designed: tenant-scoped data isolation, three-tier RBAC, white-label branding, and defensive API design. When adding features, prefer the option that makes the multi-tenancy story clearer over the option that merely adds surface area. The frontend lives in the sibling repo **vela-ui** (React 19, deployed on Vercel); this API deploys on Render.

## 🌍 Language & Localization
- **STRICT RULE:** The entire codebase MUST be written in English - variable names, comments, documentation, commit messages, and API responses.

## 🛠️ Tech Stack
- **HTTP framework:** Fastify 5 (plugins: helmet, cors, cookie, multipart, sensible, jwt, swagger)
- **ORM:** Prisma 7 with `@prisma/adapter-pg` against PostgreSQL (Neon in production). The generated client is checked in at `src/generated/` (plain TypeScript, compiled into `dist/` by the build) - never edit it by hand; change `prisma/schema.prisma` and run `npx prisma generate`.
- **Validation:** Zod 4 via `fastify-type-provider-zod` - route schemas double as OpenAPI documentation.
- **Auth:** `@fastify/jwt` signing an httpOnly `token` cookie (the `Authorization` header is deliberately not accepted - see `verify.onlyCookie` in `lib/auth.ts`). Passwords hashed with bcryptjs.
- **Testing:** Vitest integration tests (`src/tests/`) that exercise the real HTTP surface via `app.inject` against a real Postgres, with only S3 mocked.

## 🏗️ Architecture (Routes → Services → Prisma)
- **Routes (`src/routes/*.routes.ts`) only do HTTP:** parse/validate the request, call a service, map the result to a reply. Zod schemas and Swagger metadata live here. A route handler with an `if` that encodes a business rule is a code smell - move it down.
- **Services (`src/services/*.service.ts`) own the business rules:** tenant limits, slug conflicts, RBAC tenant scoping, credential checks, dashboard aggregation. Services never touch `reply` or status codes.
- **Domain errors (`src/services/errors.ts`):** services throw typed `DomainError` subclasses (`NotFoundError`, `ConflictError`, `ForbiddenError`, `BadRequestError`, `TenantHasUsersError`); the central error handler (`lib/errorHandler.ts`) translates them to HTTP. `TenantHasUsersError` is the template for machine-readable errors: it overrides `toResponse()` to include `userCount`, because vela-ui switches on the literal `TENANT_HAS_USERS` to drive its double-confirmation cascade-delete dialog. Add a new override only when the frontend actually branches on the payload.
- **`src/lib/`** is HTTP/infra plumbing: auth plugin, error handler, prisma client, S3 upload, multipart parsing, swagger setup, shared response schemas.
- **No repository-interface layer on top of Prisma:** one database, no variation axis, the ORM already is the abstraction - don't add `ITenantRepository`-style ceremony.

## 🏢 Multi-tenancy Model (the heart of this repo)
Shared database, shared schema. Every `User` belongs to exactly one `Tenant` (`tenantId` FK, `ON DELETE CASCADE`).

- **Roles:** `VELA_ADMIN` (platform root, sees across tenants) > `ADMIN` (manages one tenant) > `MEMBER`. `VELA_ADMIN` must pass every check `ADMIN` passes - a root role that fails admin-only routes is a regression. `VELA_ADMIN` is never assignable via the API; creating one requires seed/database access.
- **Isolation is enforced at the query level, in services:** e.g. `listUsers` scopes `where: { tenantId }` for anyone below `VELA_ADMIN`, and `createUser` overwrites any client-supplied `tenantId` with the caller's own when the caller is a tenant `ADMIN`. Never trust a tenant identifier from the request body for a non-root caller.
- **Self-registration (`POST /auth/register`) is always `MEMBER`:** the endpoint is public and tenant ids are enumerable via `GET /tenants/public`, so honoring a client-supplied role would let anyone self-assign `ADMIN`.
- **White-label:** `GET /tenants/:slug` is public so vela-ui can fetch a tenant's branding (name, `primaryColor`, `logoUrl`) before login.
- **Demo safeguard:** `MAX_TENANTS_LIMIT` in `tenant.service.ts` caps tenant creation to protect the free-tier database. Keep it above what the test suite creates in one run.

## 🔐 Security Invariants
- JWT lives only in an httpOnly cookie; production sets `Secure` + `SameSite=None` (cross-site Vercel↔Render), dev keeps `Lax`. Logout must clear the cookie with the same attributes it was set with (`getAuthCookieOptions` in `auth.routes.ts`).
- CORS origin comes from `FRONTEND_URL` (comma-separated for multiple); the app refuses to start in production without it. Never introduce a wildcard.
- Login returns one generic 401 for both unknown email and wrong password (no user enumeration).
- Logo uploads must be image mimetypes; S3 objects get no ACL (bucket policy grants public read - ACLs are disabled on modern buckets).
- All secrets come from `process.env`; `.env.example` is the only env file that may be committed. The pre-commit hook runs secretlint via lint-staged - if it flags a false positive, fix the pattern or add a scoped `secretlint-disable`, never `--no-verify`.

## 🧪 Testing & Quality Gates
- `npm test` runs Vitest against the database in `DATABASE_URL` - tests seed via `src/tests/helpers.ts` and clean up after themselves. CI runs them against an ephemeral Postgres 15 service with coverage uploaded to Codecov (`tests.yml`).
- `npm run lint` (eslint flat config, typescript-eslint typeChecked + prettier) and `npx tsc --noEmit` must both pass; CI enforces them in `ci.yml`, and `security.yml` runs `npm audit` + a secretlint sweep (weekly cron too).
- `tsconfig.json` covers everything for tooling; `tsconfig.build.json` (used by `npm run build`) excludes tests.
- New business logic goes in a service and gets exercised through a route-level integration test - that keeps coverage meaningful (behavior, not implementation).

## 🌿 Version Control & Git Strategy
- **Branching:** Gitflow - `main` (production), `develop` (integration), `feature/*` / `bugfix/*` / `chore/*` branches off `develop`.
- **Conventional Commits, in English, always** (`feat(api):`, `fix(api):`, `refactor(api):`, `chore(api):`, `docs:`, `test:`). Each PR is one atomic change, squash-merged with a clean final message.
- **AI Git Execution:** when asked to commit, branch off first (never commit directly to `main`), and craft the Semantic Commit message for the eventual squash-merge.

## 🤖 AI Assistant Directives
1. **Always read this file** when starting a session, creating features, or answering architectural questions here.
2. **Do not ask for interactive inputs** - use non-interactive flags.
3. **Database changes:** always create a Prisma migration explicitly (`npx prisma migrate dev --name <change>`); never `db push` against shared environments.
4. **Keep vela-ui in sync:** error codes/shapes the frontend branches on (`TENANT_HAS_USERS`, the `scope` discriminant in metrics) are a cross-repo contract - changing them means changing vela-ui in the same milestone. The checked-in `swagger.json` in vela-ui's repo root mirrors this API's OpenAPI output; regenerate it after changing any route's shape.
5. **English-only demo data:** seeds and fixtures are recruiter-visible - keep them professional and English.
