# Vela Core - API (SaaS Backend)

[![CI/CD](https://img.shields.io/github/actions/workflow/status/samuelcsantana/vela-core/ci.yml?branch=main&label=CI%2FCD&logo=githubactions&logoColor=white)](https://github.com/samuelcsantana/vela-core/actions/workflows/ci.yml)
[![Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0%20high%2Fcritical-brightgreen?logo=npm&logoColor=white)](https://github.com/samuelcsantana/vela-core/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/samuelcsantana/vela-core/branch/main/graph/badge.svg)](https://codecov.io/gh/samuelcsantana/vela-core)

Backend engine for **Vela**, a multi-tenant SaaS platform. Built with Fastify and TypeScript on a multi-tenant architecture, it provides tenant-scoped data isolation, JWT authentication, and role-based access control (RBAC) out of the box.

## Tech Stack

| Layer          | Technology                                             |
| -------------- | ------------------------------------------------------- |
| Runtime        | Node.js (TypeScript, ES2022, ESM modules via NodeNext)   |
| HTTP framework | [Fastify 5](https://fastify.dev/)                        |
| ORM            | [Prisma 7](https://www.prisma.io/) (`@prisma/adapter-pg`) |
| Database       | PostgreSQL (developed against [Neon](https://neon.tech)) |
| Validation     | [Zod](https://zod.dev/)                                   |
| Auth           | `@fastify/jwt` + `bcryptjs`                                |
| Security headers | `@fastify/helmet` (HSTS, X-Frame-Options, X-Content-Type-Options, etc.) |
| File uploads   | `@fastify/multipart` + AWS S3 (`@aws-sdk/client-s3`), for tenant logos |
| API Docs       | `@fastify/swagger` + `@fastify/swagger-ui` (OpenAPI 3.0.0) |
| Testing        | [Vitest](https://vitest.dev/) + `@vitest/coverage-v8`      |
| CI/CD          | GitHub Actions (with an ephemeral Postgres 15 service)     |

## Security

- **RBAC** - three-tier roles (`VELA_ADMIN` > `ADMIN` > `MEMBER`), enforced at the query level so tenant data never leaks across companies. Full details in [RBAC Security](#rbac-security) below.
- **JWT authentication** - signed via `@fastify/jwt`, delivered as an `httpOnly` cookie (never touches client-side JavaScript, so it can't be exfiltrated by XSS). The `Authorization` header is not accepted.
- **Restricted CORS** - no wildcard origin. In production, only the exact origin(s) in `FRONTEND_URL` are allowed (comma-separated for multiple, e.g. a Vercel production + preview URL); the app refuses to start in production without it set. The `token` cookie is `Secure` + `SameSite=None` in production to survive the cross-site request between a Vercel frontend and this API, and `SameSite=Lax` locally where there's no HTTPS.
- **AWS S3 multipart upload** - tenant logo uploads (`POST`/`PATCH /api/tenants`) are parsed via `@fastify/multipart`, validated to be an image `mimetype` before upload, and require the bucket to grant public read via a bucket policy (not object ACLs, which are disabled by default on buckets created since April 2023).
- **Security headers** - `@fastify/helmet` adds HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and friends to every response.
- **Credential hygiene** - all secrets (`DATABASE_URL`, `JWT_SECRET`, AWS keys) are read exclusively from `process.env`, never hardcoded. `.gitignore` blocks every `.env*` variant except the checked-in `.env.example` template.

## Multi-tenant Architecture

Vela Core follows a **shared database, shared schema** multi-tenancy model:

- Every `Tenant` (`name`, `slug`, `primaryColor`, `logoUrl`) represents a distinct customer/company. The `slug` powers white-label lookups (e.g. a frontend fetching branding for `acme.vela.app` calls `GET /api/tenants/acme` before the user even logs in).
- Every `User` belongs to exactly one `Tenant` via `tenantId` (foreign key), and authenticates with an `email` + `passwordHash` (bcrypt, salt rounds: 10).
- Data access is scoped by tenant at the query level: for example, `GET /api/users` reads `tenantId` out of the authenticated JWT payload and only returns users belonging to that tenant — a user can never enumerate another company's data.

## RBAC Security

Authorization is layered on top of authentication using two composable Fastify hooks (`src/lib/auth.ts`):

- **`authenticate`** — verifies the JWT stored in the `token` httpOnly cookie via `@fastify/jwt`. Populates `request.user` with `{ id, role, tenantId }`. The `Authorization` header is not accepted; the token never touches client-side JavaScript, which protects it from XSS.
- **`verifyAdmin`** — runs after `authenticate` and checks `request.user.role === 'ADMIN' || request.user.role === 'VELA_ADMIN'`. Non-admins get a `403` with a standardized message.

`role` is a Postgres enum (`prisma/schema.prisma`) with three tiers:

| Role         | Scope                        | Can do                                                                 |
| ------------ | ----------------------------- | ------------------------------------------------------------------------ |
| `VELA_ADMIN` | System-wide (root)            | Everything `ADMIN` can do, across **every** tenant — e.g. `GET /api/users` returns all users system-wide, not just their own tenant's. |
| `ADMIN`      | Own tenant                    | Create, update and delete tenants (`POST`/`PATCH`/`DELETE /api/tenants`), create users and list users (`POST`/`GET /api/users`, scoped to their own tenant). |
| `MEMBER`     | Own tenant, read-only         | List tenants, read tenant white-label data. Cannot call `GET /api/users` (`403`). |

There is currently no API route to promote a user to `ADMIN` or `VELA_ADMIN` — those roles are only ever set via `prisma/seed.ts` or direct database access.

| Endpoint                   | Auth required                  | Notes                                                              |
| ---------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `POST /api/auth/login`     | —                               | Public. Sets the `token` httpOnly cookie.                          |
| `POST /api/auth/logout`    | —                               | Public. Clears the `token` cookie.                                 |
| `POST /api/auth/register`  | —                               | Public. Joins an existing tenant as `MEMBER` (a client-supplied `role` is ignored). |
| `GET /api/tenants/:slug`   | —                               | Public. White-label branding lookup, used before login.            |
| `GET /api/tenants/public`  | —                               | Public. Minimal fields (`id`, `name`, `slug`) for a tenant picker.  |
| `GET /api/tenants`         | `authenticate`                  | Any authenticated user.                                             |
| `POST /api/tenants`        | `authenticate` + `verifyAdmin`  | Admins only. `multipart/form-data`; optional `logo` file uploads to S3. |
| `PATCH /api/tenants/:id`   | `authenticate` + `verifyAdmin`  | Admins only. `multipart/form-data`; partial update, including `logo`. |
| `DELETE /api/tenants/:id`  | `authenticate` + `verifyAdmin`  | Admins only. `409 { error: 'TENANT_HAS_USERS', userCount }` if the tenant still has users, unless `?force=true` (cascade-deletes its users too). |
| `GET /api/users`           | `authenticate` + `verifyAdmin`  | Admins only (`MEMBER` gets `403`). `VELA_ADMIN` sees every tenant; `ADMIN` sees only their own. Includes `tenant: { name, slug }`. |
| `POST /api/users`          | `authenticate` + `verifyAdmin`  | Admins only. Optional `role` (`ADMIN`/`MEMBER`, default `MEMBER`). `VELA_ADMIN` sets `tenantId` freely; `ADMIN`'s payload `tenantId` is ignored and forced to their own tenant. |
| `GET /api/metrics/dashboard` | `authenticate`                | Any authenticated user (not admin-restricted). Response shape depends on role: `VELA_ADMIN` gets `scope: "GLOBAL"` (`totalTenants`, `totalUsers`, a per-tenant user breakdown, the 5 most recent signups); `ADMIN`/`MEMBER` get `scope: "TENANT"` (`totalUsers` and a per-role breakdown, scoped to their own tenant). |

## Local Setup

### Prerequisites

- Node.js 20+
- A PostgreSQL database (local or hosted, e.g. [Neon](https://neon.tech))

### Environment variables

Copy `.env.example` to `.env` and fill in real values - never commit `.env` itself (it's gitignored, along with every other `.env.*` variant except the example file):

```bash
cp .env.example .env
```

| Variable                | Required        | Purpose                                                                 |
| ------------------------ | ---------------- | ------------------------------------------------------------------------ |
| `DATABASE_URL`          | Always           | PostgreSQL connection string.                                          |
| `JWT_SECRET`            | Always           | Signs and verifies the auth JWT.                                       |
| `AWS_REGION`            | For logo uploads | S3 bucket's region.                                                    |
| `AWS_ACCESS_KEY_ID`     | For logo uploads | IAM credentials for S3.                                                |
| `AWS_SECRET_ACCESS_KEY` | For logo uploads | IAM credentials for S3.                                                |
| `AWS_S3_BUCKET_NAME`    | For logo uploads | Target bucket - must grant public read via a bucket policy, not object ACLs (disabled by default on buckets created since April 2023). |
| `FRONTEND_URL`          | When `NODE_ENV=production` | Exact frontend origin(s) allowed by CORS, comma-separated for more than one. The app refuses to start in production without it. |
| `NODE_ENV`              | Recommended in prod | `development` \| `production`. Governs cookie `Secure`/`SameSite` and CORS origin resolution (see below). |
| `PORT`                  | Optional         | Defaults to `3333`. Cloud platforms (e.g. Render) set this dynamically. |

Set `NODE_ENV=production` when deploying behind HTTPS. This makes the `token` cookie `Secure` + `SameSite=None` instead of the dev-mode `SameSite=Lax` - required because the frontend (e.g. Vercel) and this API (e.g. Render) live on different domains, making every request cross-site; `SameSite=Lax` is dropped from cross-site requests by the browser, and `SameSite=None` is rejected outright unless `Secure` is also set. It also switches CORS from the hardcoded `http://localhost:3000` dev origin to `FRONTEND_URL` - which becomes **required**, the app refuses to start in production without it, rather than falling back to something permissive.

### Commands

```bash
# install dependencies
npm install

# apply the database schema
npx prisma migrate dev

# seed an admin/guest user and a demo tenant
npx prisma db seed

# start the dev server (hot reload) on http://localhost:3333
npm run dev

# run the test suite
npm test

# run tests with a coverage report
npm run test:coverage

# type-check and build for production
npm run build
npm start
```

The seed script (`prisma/seed.ts`) creates a "Vela Admin" tenant (`slug: vela`) with three accounts for evaluation purposes:

| Email                   | Password          | Role         |
| ----------------------- | ----------------- | ------------ |
| `admin@vela.com`        | `admin123`        | `VELA_ADMIN` |
| `tenantadmin@vela.com`  | `tenantadmin123`  | `ADMIN`      |
| `guest@vela.com`        | `guest123`        | `MEMBER`     |

## API Documentation

Interactive OpenAPI 3.0.0 documentation (Swagger UI) is served at:

```
GET /docs
```

The raw OpenAPI spec is available at `GET /docs/json`. The spec declares a `cookieAuth` (apiKey, in `cookie`) security scheme, matching the httpOnly `token` cookie expected by protected routes. Since Swagger UI's "Try it out" can't set httpOnly cookies for you, log in via `POST /api/auth/login` from a real HTTP client (e.g. `curl -c`) to exercise protected routes interactively.

## Continuous Integration

Every push and pull request to `main` or `develop` triggers `.github/workflows/ci.yml`, which:

1. Spins up an ephemeral `postgres:15` service container.
2. Installs dependencies with `npm ci`.
3. Runs `npm audit --audit-level=high` as a security gate.
4. Applies migrations (`prisma migrate deploy`) and seeds the database against the ephemeral Postgres instance.
5. Runs the full test suite with coverage (`npm run test:coverage`).
6. Uploads the `lcov.info` report to [Codecov](https://codecov.io/gh/samuelcsantana/vela-core), which generates the coverage badge above.

`vitest.config.ts` enforces a 100% coverage threshold (lines, functions, branches, statements) — the CI run fails if any metric drops below that.

The CI/CD and Coverage badges above are live (generated from the latest run on `main`). The Vulnerabilities badge is static text, manually updated whenever `npm audit` output changes materially.
