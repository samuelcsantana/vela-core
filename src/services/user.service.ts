import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import type { JwtPayload } from '../lib/auth.js';
import type { Role } from '../generated/prisma/client.js';
import { BadRequestError } from './errors.js';

const BCRYPT_SALT_ROUNDS = 10;

// Fields safe to return to clients - never the password hash.
const userPublicSelect = {
  id: true,
  email: true,
  role: true,
  tenantId: true,
  createdAt: true,
} as const;

export interface CreateUserInput {
  email: string;
  password: string;
  tenantId?: string;
  role?: Role;
}

export async function createUser(requester: JwtPayload, { email, password, tenantId: requestedTenantId, role }: CreateUserInput) {
  let tenantId: string;

  if (requester.role === 'VELA_ADMIN') {
    if (!requestedTenantId) {
      throw new BadRequestError('tenantId is required when creating a user as VELA_ADMIN');
    }
    tenantId = requestedTenantId;
  } else {
    // Tenant ADMIN: always scoped to their own tenant, regardless of
    // what was sent in the payload - prevents provisioning users into
    // another company.
    tenantId = requester.tenantId;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  return prisma.user.create({
    data: { email, passwordHash, tenantId, role: role ?? 'MEMBER' },
    select: userPublicSelect,
  });
}

// VELA_ADMIN sees every user across every tenant; anyone else only their own
// tenant - the tenant boundary is enforced here at the query level, not left
// to the caller.
export function listUsers(requester: JwtPayload) {
  return prisma.user.findMany({
    where: requester.role === 'VELA_ADMIN' ? {} : { tenantId: requester.tenantId },
    select: {
      ...userPublicSelect,
      tenant: {
        select: { name: true, slug: true },
      },
    },
  });
}
