import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import {
  ADMIN_CREDENTIALS,
  GUEST_CREDENTIALS,
  VELA_ADMIN_CREDENTIALS,
  seedBaseData,
  extractTokenCookie,
} from './helpers.js';

describe('User routes - exception flows', () => {
  const app = buildApp();
  const createdUserEmails: string[] = [];
  const createdTenantSlugs: string[] = [];
  let adminToken: string;
  let guestToken: string;
  let velaAdminToken: string;
  let tenantId: string;
  let foreignTenantId: string;

  beforeAll(async () => {
    await app.ready();
    const tenant = await seedBaseData();
    tenantId = tenant.id;

    // A tenant the seeded ADMIN does not belong to - used by the cross-tenant
    // boundary tests below.
    const foreignSlug = `foreign-${Date.now()}`;
    createdTenantSlugs.push(foreignSlug);
    const foreignTenant = await prisma.tenant.create({
      data: { name: 'Foreign Co', slug: foreignSlug },
    });
    foreignTenantId = foreignTenant.id;

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });
    adminToken = extractTokenCookie(adminLogin);

    const guestLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: GUEST_CREDENTIALS,
    });
    guestToken = extractTokenCookie(guestLogin);

    const velaAdminLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: VELA_ADMIN_CREDENTIALS,
    });
    velaAdminToken = extractTokenCookie(velaAdminLogin);
  });

  afterAll(async () => {
    // Users first - Tenant is ON DELETE RESTRICT.
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    if (createdTenantSlugs.length > 0) {
      await prisma.tenant.deleteMany({ where: { slug: { in: createdTenantSlugs } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('blocks a non-admin (guest) from creating a user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: guestToken },
      payload: { email: `blocked-${Date.now()}@vela.com`, password: 'secret123', tenantId },
    });

    expect(response.statusCode).toBe(403);
  });

  it('allows an admin to create a user without leaking the password hash', async () => {
    const email = `new-user-${Date.now()}@vela.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { email, password: 'secret123', tenantId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().email).toBe(email);
    expect(response.json().passwordHash).toBeUndefined();
  });

  it('returns 409 when the email already exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { email: ADMIN_CREDENTIALS.email, password: 'secret123', tenantId },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Resource already exists' });
  });

  it('returns 500 when VELA_ADMIN references a tenant that does not exist', async () => {
    // A tenant ADMIN's tenantId is always overridden with their own (see the
    // test below), so this FK-violation path can only be reached by a
    // VELA_ADMIN, who is trusted to supply tenantId directly.
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: velaAdminToken },
      payload: {
        email: `orphan-${Date.now()}@vela.com`,
        password: 'secret123',
        tenantId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 400 when VELA_ADMIN omits tenantId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: velaAdminToken },
      payload: { email: `no-tenant-${Date.now()}@example.com`, password: 'secret123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('tenantId is required when creating a user as VELA_ADMIN');
  });

  it("ignores a tenant ADMIN's payload tenantId and scopes the new user to the admin's own tenant", async () => {
    const otherSlug = `admin-cannot-touch-${Date.now()}`;
    createdTenantSlugs.push(otherSlug);
    const otherTenant = await prisma.tenant.create({ data: { name: 'Other Co', slug: otherSlug } });

    const email = `boundary-check-${Date.now()}@vela.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { email, password: 'secret123', tenantId: otherTenant.id },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().tenantId).toBe(tenantId);
    expect(response.json().tenantId).not.toBe(otherTenant.id);
  });

  it('lets a tenant ADMIN create a co-admin within their own tenant', async () => {
    const email = `co-admin-${Date.now()}@vela.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { email, password: 'secret123', role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe('ADMIN');
    expect(response.json().tenantId).toBe(tenantId);
  });

  it('defaults role to MEMBER when omitted', async () => {
    const email = `default-role-${Date.now()}@vela.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { email, password: 'secret123' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe('MEMBER');
  });

  it('lets VELA_ADMIN create a user with an explicit role for any tenant', async () => {
    const otherSlug = `vela-admin-target-${Date.now()}`;
    createdTenantSlugs.push(otherSlug);
    const otherTenant = await prisma.tenant.create({
      data: { name: 'Vela Admin Target Co', slug: otherSlug },
    });

    const email = `vela-admin-created-${Date.now()}@example.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: velaAdminToken },
      payload: { email, password: 'secret123', tenantId: otherTenant.id, role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().tenantId).toBe(otherTenant.id);
    expect(response.json().role).toBe('ADMIN');
  });

  it('blocks a MEMBER from listing users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { token: guestToken },
    });

    expect(response.statusCode).toBe(403);
  });

  it('scopes an ADMIN to only their own tenant, including tenant name/slug', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(200);
    const users = response.json<Array<{ tenantId: string; tenant: { slug: string } }>>();
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((user) => user.tenantId === tenantId)).toBe(true);
    expect(users.every((user) => user.tenant.slug === 'vela')).toBe(true);
  });

  it('lets a VELA_ADMIN see users across every tenant', async () => {
    const otherSlug = `other-tenant-${Date.now()}`;
    createdTenantSlugs.push(otherSlug);

    const otherTenant = await prisma.tenant.create({ data: { name: 'Other Co', slug: otherSlug } });

    const otherEmail = `member-of-other-${Date.now()}@example.com`;
    createdUserEmails.push(otherEmail);

    await prisma.user.create({
      data: { email: otherEmail, passwordHash: 'irrelevant-for-this-test', tenantId: otherTenant.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { token: velaAdminToken },
    });

    expect(response.statusCode).toBe(200);
    const users = response.json<Array<{ tenantId: string; email: string }>>();
    const tenantIdsSeen = new Set(users.map((user) => user.tenantId));

    expect(tenantIdsSeen.has(tenantId)).toBe(true);
    expect(tenantIdsSeen.has(otherTenant.id)).toBe(true);
    expect(users.some((user) => user.email === otherEmail)).toBe(true);
  });

  async function createUserViaApi(payload: Record<string, string>): Promise<string> {
    createdUserEmails.push(payload.email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: { password: 'secret123', ...payload },
    });

    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>().id;
  }

  it('returns 404 when updating a user that does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/users/00000000-0000-0000-0000-000000000000',
      cookies: { token: adminToken },
      payload: { email: `ghost-${Date.now()}@vela.com` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('User not found');
  });

  it('lets an admin update email, role and password of a user in their own tenant', async () => {
    const email = `patch-me-${Date.now()}@vela.com`;
    const newEmail = `patched-${Date.now()}@vela.com`;
    createdUserEmails.push(newEmail);
    const userId = await createUserViaApi({ email });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${userId}`,
      cookies: { token: adminToken },
      payload: { email: newEmail, role: 'ADMIN', password: 'rotated456' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe(newEmail);
    expect(response.json().role).toBe('ADMIN');
    expect(response.json().passwordHash).toBeUndefined();

    // The new password must be re-hashed, not stored raw - proven by logging in with it.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: newEmail, password: 'rotated456' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('blocks a tenant ADMIN from editing a user in another tenant', async () => {
    const email = `foreign-member-${Date.now()}@example.com`;
    createdUserEmails.push(email);
    const foreignUser = await prisma.user.create({
      data: { email, passwordHash: 'irrelevant-for-this-test', tenantId: foreignTenantId },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${foreignUser.id}`,
      cookies: { token: adminToken },
      payload: { email: `hijacked-${Date.now()}@example.com` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('You can only edit users in your own tenant');
  });

  it('blocks a tenant ADMIN from moving a user to another tenant', async () => {
    const userId = await createUserViaApi({ email: `move-attempt-${Date.now()}@vela.com` });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${userId}`,
      cookies: { token: adminToken },
      payload: { tenantId: foreignTenantId },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Only VELA_ADMIN can move a user to another tenant');
  });

  it('lets VELA_ADMIN edit a user in any tenant, including moving it', async () => {
    const userId = await createUserViaApi({ email: `movable-${Date.now()}@vela.com` });

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${userId}`,
      cookies: { token: velaAdminToken },
      payload: { tenantId: foreignTenantId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().tenantId).toBe(foreignTenantId);
  });

  it('blocks an admin from changing their own role', async () => {
    const email = `self-demote-${Date.now()}@vela.com`;
    const selfId = await createUserViaApi({ email, role: 'ADMIN' });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'secret123' },
    });
    const selfToken = extractTokenCookie(login);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${selfId}`,
      cookies: { token: selfToken },
      payload: { role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('You cannot change your own role');
  });

  it('allows re-submitting your own current role (no-op role change)', async () => {
    const email = `self-same-role-${Date.now()}@vela.com`;
    const selfId = await createUserViaApi({ email, role: 'ADMIN' });

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'secret123' },
    });
    const selfToken = extractTokenCookie(login);

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/users/${selfId}`,
      cookies: { token: selfToken },
      payload: { role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe('ADMIN');
  });

  it('returns 404 when deleting a user that does not exist', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/users/00000000-0000-0000-0000-000000000000',
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('User not found');
  });

  it('blocks a user from deleting their own account', async () => {
    const admin = await prisma.user.findUnique({ where: { email: ADMIN_CREDENTIALS.email } });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/users/${admin!.id}`,
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('You cannot delete your own account');
  });

  it('blocks a tenant ADMIN from deleting a user in another tenant', async () => {
    const email = `foreign-delete-target-${Date.now()}@example.com`;
    createdUserEmails.push(email);
    const foreignUser = await prisma.user.create({
      data: { email, passwordHash: 'irrelevant-for-this-test', tenantId: foreignTenantId },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/users/${foreignUser.id}`,
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('You can only delete users in your own tenant');
  });

  it('lets an admin delete a user in their own tenant', async () => {
    const userId = await createUserViaApi({ email: `delete-me-${Date.now()}@vela.com` });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}`,
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'User deleted successfully' });

    const gone = await prisma.user.findUnique({ where: { id: userId } });
    expect(gone).toBeNull();
  });

  it('lets VELA_ADMIN delete a user in any tenant', async () => {
    const email = `vela-admin-deletes-${Date.now()}@example.com`;
    createdUserEmails.push(email);
    const foreignUser = await prisma.user.create({
      data: { email, passwordHash: 'irrelevant-for-this-test', tenantId: foreignTenantId },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/users/${foreignUser.id}`,
      cookies: { token: velaAdminToken },
    });

    expect(response.statusCode).toBe(200);

    const gone = await prisma.user.findUnique({ where: { id: foreignUser.id } });
    expect(gone).toBeNull();
  });
});
