import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import type { JwtPayload } from '../lib/auth.js';
import type { Role } from '../generated/prisma/client.js';
import { BadRequestError, ForbiddenError, NotFoundError } from './errors.js';

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

export interface UpdateUserInput {
  email?: string;
  password?: string;
  role?: Role;
  tenantId?: string;
}

export async function createUser(
  requester: JwtPayload,
  { email, password, tenantId: requestedTenantId, role }: CreateUserInput,
) {
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

export async function updateUser(requester: JwtPayload, id: string, input: UpdateUserInput) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Tenant ADMIN can only edit users in their own tenant.
  if (requester.role !== 'VELA_ADMIN' && user.tenantId !== requester.tenantId) {
    throw new ForbiddenError('You can only edit users in your own tenant');
  }

  // Only VELA_ADMIN can change the tenant.
  if (input.tenantId && requester.role !== 'VELA_ADMIN') {
    throw new ForbiddenError('Only VELA_ADMIN can move a user to another tenant');
  }

  // Prevent self-demotion or self-deletion via role changes.
  if (input.role && user.id === requester.id && input.role !== user.role) {
    throw new ForbiddenError('You cannot change your own role');
  }

  const data: Record<string, unknown> = {};
  if (input.email !== undefined) data.email = input.email;
  if (input.role !== undefined) data.role = input.role;
  if (input.tenantId !== undefined) data.tenantId = input.tenantId;
  if (input.password !== undefined) {
    data.passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
  }

  return prisma.user.update({
    where: { id },
    data,
    select: userPublicSelect,
  });
}

export async function deleteUser(requester: JwtPayload, id: string) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  // Prevent self-deletion.
  if (user.id === requester.id) {
    throw new ForbiddenError('You cannot delete your own account');
  }

  // Tenant ADMIN can only delete users in their own tenant.
  if (requester.role !== 'VELA_ADMIN' && user.tenantId !== requester.tenantId) {
    throw new ForbiddenError('You can only delete users in your own tenant');
  }

  await prisma.user.delete({ where: { id } });
}
