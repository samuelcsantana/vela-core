# syntax=docker/dockerfile:1

# ---- deps: full install (dev + prod), needed to generate the Prisma client,
# type-check and build. postinstall runs `prisma generate`, which reads
# prisma/schema.prisma - so the schema must be in place before npm ci. ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- builder: compile TypeScript to dist/ (the generated Prisma client in
# src/generated is plain TypeScript, so it compiles into dist/ too) ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only node_modules. --ignore-scripts skips the
# prisma-generate postinstall, which would fail here (the prisma CLI is a
# devDependency) and is unnecessary anyway - the generated client is already
# compiled into dist/. ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- production: minimal runtime image ----
FROM node:22-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# Schema + migrations ship with the image so `npx prisma migrate deploy` can
# run against the production database at release time.
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node package.json ./

USER node

EXPOSE 3333

CMD ["node", "dist/server.js"]
