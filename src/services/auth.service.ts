import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { ConflictError } from './errors.js';

const BCRYPT_SALT_ROUNDS = 10;

// Returns the full user on success and null on any failure - the route maps
// null to a single generic 401 so a caller can't distinguish "email not
// found" from "wrong password" (user-enumeration hardening).
export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  return isValidPassword ? user : null;
}

export interface RegisterMemberInput {
  email: string;
  password: string;
  tenantId: string;
}

// Self-registration is always MEMBER: this backs a public, unauthenticated
// endpoint, so trusting a client-supplied role would let anyone self-assign
// ADMIN on any tenant (tenant ids are public via GET /tenants/public).
export async function registerMember({ email, password, tenantId }: RegisterMemberInput) {
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser) {
    throw new ConflictError('A user with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  return prisma.user.create({
    data: { email, passwordHash, tenantId, role: 'MEMBER' },
  });
}
