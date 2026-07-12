import { prisma } from '../lib/prisma.js';
import { uploadLogo } from '../lib/s3.js';
import { ConflictError, ForbiddenError, NotFoundError, TenantHasUsersError } from './errors.js';

// Portfolio demo safeguard against exhausting the free-tier database plan.
// Set well above the tenant count our own test suite creates in a single
// run (see tenant.routes.spec.ts + auth.e2e.spec.ts), so CI never trips it.
export const MAX_TENANTS_LIMIT = 20;

// Domain-level view of an uploaded logo. The HTTP layer (lib/multipart.ts)
// produces this shape from a multipart request; the service only cares about
// the bytes and metadata, not where they came from.
export interface LogoFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

export interface CreateTenantInput {
  name: string;
  slug: string;
  primaryColor?: string;
  logo?: LogoFile;
}

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  primaryColor?: string;
  logo?: LogoFile;
}

export async function createTenant({ name, slug, primaryColor, logo }: CreateTenantInput) {
  const tenantCount = await prisma.tenant.count();

  if (tenantCount >= MAX_TENANTS_LIMIT) {
    throw new ForbiddenError(
      `Free tier limit reached. Maximum number of tenants allowed in this demo is ${MAX_TENANTS_LIMIT}.`,
    );
  }

  // A duplicate slug is deliberately not pre-checked here: Tenant.slug is
  // unique at the database level, so Prisma's P2002 error surfaces through
  // the central error handler as a 409 without a race-prone extra query.
  const logoUrl = logo ? await uploadLogo(logo.buffer, logo.filename, logo.mimetype) : undefined;

  return prisma.tenant.create({
    data: { name, slug, primaryColor, logoUrl },
  });
}

export function listTenants() {
  return prisma.tenant.findMany();
}

// Only non-sensitive fields, safe to expose without authentication - powers
// the tenant picker on the registration screen.
export function listPublicTenants() {
  return prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
  });
}

// Public white-label lookup, used to fetch branding before login.
export async function getTenantBySlug(slug: string) {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  return tenant;
}

export async function updateTenant(id: string, { name, slug, primaryColor, logo }: UpdateTenantInput) {
  const existingTenant = await prisma.tenant.findUnique({ where: { id } });

  if (!existingTenant) {
    throw new NotFoundError('Tenant not found');
  }

  if (slug) {
    const tenantWithSlug = await prisma.tenant.findUnique({ where: { slug } });

    if (tenantWithSlug && tenantWithSlug.id !== id) {
      throw new ConflictError('Another tenant already uses this slug');
    }
  }

  const logoUrl = logo ? await uploadLogo(logo.buffer, logo.filename, logo.mimetype) : undefined;

  return prisma.tenant.update({
    where: { id },
    data: { name, slug, primaryColor, logoUrl },
  });
}

export async function deleteTenant(id: string, forceDelete: boolean) {
  const existingTenant = await prisma.tenant.findUnique({ where: { id } });

  if (!existingTenant) {
    throw new NotFoundError('Tenant not found');
  }

  if (!forceDelete) {
    const userCount = await prisma.user.count({ where: { tenantId: id } });

    if (userCount > 0) {
      throw new TenantHasUsersError(userCount);
    }
  }

  // With force=true (or no remaining users), User.tenantId's ON DELETE
  // CASCADE handles removing the tenant's users at the database level.
  await prisma.tenant.delete({ where: { id } });
}
