# Vela Core

[![CI/CD](https://img.shields.io/github/actions/workflow/status/samuelcsantana/vela-core/ci.yml?branch=main&label=CI%2FCD&logo=githubactions&logoColor=white)](https://github.com/samuelcsantana/vela-core/actions/workflows/ci.yml)
[![Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0%20high%2Fcritical-brightgreen?logo=npm&logoColor=white)](https://github.com/samuelcsantana/vela-core/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/samuelcsantana/vela-core/branch/main/graph/badge.svg)](https://codecov.io/gh/samuelcsantana/vela-core)

Backend API for **Vela**, a multi-tenant SaaS platform. Built with Fastify and TypeScript, it provides tenant-scoped data isolation, JWT authentication, and role-based access control (RBAC) out of the box.

## Tech Stack

| Layer          | Technology                                             |
| -------------- | ------------------------------------------------------- |
| Runtime        | Node.js (TypeScript, ES2022, NodeNext modules)           |
| HTTP framework | [Fastify 5](https://fastify.dev/)                        |
| ORM            | [Prisma 7](https://www.prisma.io/) (`@prisma/adapter-pg`) |
| Database       | PostgreSQL                                                |
| Validation     | [Zod](https://zod.dev/)                                   |
| Auth           | `@fastify/jwt` + `bcryptjs`                                |
| API Docs       | `@fastify/swagger` + `@fastify/swagger-ui` (OpenAPI 3.0.0) |
| Testing        | [Vitest](https://vitest.dev/) + `@vitest/coverage-v8`      |
| CI/CD          | GitHub Actions (with an ephemeral Postgres 15 service)     |

## Multi-tenant Architecture

Vela Core follows a **shared database, shared schema** multi-tenancy model:

- Every `Tenant` (`name`, `slug`, `primaryColor`, `logoUrl`) represents a distinct customer/company. The `slug` powers white-label lookups (e.g. a frontend fetching branding for `acme.vela.app` calls `GET /api/tenants/acme` before the user even logs in).
- Every `User` belongs to exactly one `Tenant` via `tenantId` (foreign key), and authenticates with an `email` + `passwordHash` (bcrypt, salt rounds: 10).
- Data access is scoped by tenant at the query level: for example, `GET /api/users` reads `tenantId` out of the authenticated JWT payload and only returns users belonging to that tenant — a user can never enumerate another company's data.

## RBAC Security

Authorization is layered on top of authentication using two composable Fastify hooks (`src/lib/auth.ts`):

- **`authenticate`** — verifies the `Authorization: Bearer <token>` header via `@fastify/jwt`. Populates `request.user` with `{ id, role, tenantId }`.
- **`verifyAdmin`** — runs after `authenticate` and checks `request.user.role === 'ADMIN'`. Non-admins get a `403` with a standardized message.

There are two roles:

| Role     | Can do                                                                 |
| -------- | ------------------------------------------------------------------------ |
| `ADMIN`  | Create tenants (`POST /api/tenants`), create users (`POST /api/users`), plus everything a `MEMBER` can do |
| `MEMBER` | List tenants, list users of their own tenant, read tenant white-label data |

| Endpoint                | Auth required   | Notes                                   |
| ------------------------ | --------------- | ---------------------------------------- |
| `POST /api/auth/login`   | —               | Public. Returns a JWT.                   |
| `GET /api/tenants/:slug` | —               | Public. Used for white-label branding.   |
| `GET /api/tenants`       | `authenticate`  | Any authenticated user.                  |
| `POST /api/tenants`      | `authenticate` + `verifyAdmin` | Admins only. |
| `GET /api/users`         | `authenticate`  | Scoped to the caller's own tenant.       |
| `POST /api/users`        | `authenticate` + `verifyAdmin` | Admins only. |

## Local Setup

### Prerequisites

- Node.js 20+
- A PostgreSQL database (local or hosted, e.g. [Neon](https://neon.tech))

### Environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://user:password@host:5432/dbname"
JWT_SECRET="your-secret-key"
```

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

The seed script (`prisma/seed.ts`) creates a "Vela Admin" tenant (`slug: vela`) with two accounts for evaluation purposes:

| Email             | Password  | Role     |
| ----------------- | --------- | -------- |
| `admin@vela.com`  | `admin123`| `ADMIN`  |
| `guest@vela.com`  | `guest123`| `MEMBER` |

## API Documentation

Interactive OpenAPI 3.0.0 documentation (Swagger UI) is served at:

```
GET /docs
```

The raw OpenAPI spec is available at `GET /docs/json`. The spec declares a `bearerAuth` (JWT) security scheme, matching the `Authorization: Bearer <token>` header expected by protected routes.

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
