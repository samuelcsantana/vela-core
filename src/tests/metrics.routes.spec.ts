import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { GUEST_CREDENTIALS, VELA_ADMIN_CREDENTIALS, seedBaseData, extractTokenCookie } from './helpers.js';

describe('Metrics routes', () => {
  const app = buildApp();
  const createdUserEmails: string[] = [];
  const createdTenantSlugs: string[] = [];
  let guestToken: string;
  let velaAdminToken: string;

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();

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

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/dashboard',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns TENANT-scoped metrics for a MEMBER too - this endpoint is not admin-restricted', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/dashboard',
      cookies: { token: guestToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().scope).toBe('TENANT');
  });

  it("returns TENANT-scoped metrics matching an isolated tenant's exact user composition", async () => {
    // A dedicated, uniquely-named tenant (rather than the shared 'vela' seed
    // tenant) keeps this assertion exact: other spec files run concurrently
    // against the same database and create/delete users in 'vela', which
    // would otherwise race with a live count taken here.
    const slug = `metrics-tenant-${Date.now()}`;
    createdTenantSlugs.push(slug);
    const isolatedTenant = await prisma.tenant.create({ data: { name: 'Metrics Isolated Co', slug } });

    const adminEmail = `metrics-admin-${Date.now()}@example.com`;
    const memberEmail1 = `metrics-member-1-${Date.now()}@example.com`;
    const memberEmail2 = `metrics-member-2-${Date.now()}@example.com`;
    createdUserEmails.push(adminEmail, memberEmail1, memberEmail2);

    const password = 'secret123';
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: { email: adminEmail, passwordHash, role: 'ADMIN', tenantId: isolatedTenant.id },
    });
    await prisma.user.create({
      data: { email: memberEmail1, passwordHash, role: 'MEMBER', tenantId: isolatedTenant.id },
    });
    await prisma.user.create({
      data: { email: memberEmail2, passwordHash, role: 'MEMBER', tenantId: isolatedTenant.id },
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: adminEmail, password },
    });
    const isolatedAdminToken = extractTokenCookie(loginResponse);

    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/dashboard',
      cookies: { token: isolatedAdminToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.scope).toBe('TENANT');
    expect(body.totalUsers).toBe(3);
    expect(body.usersByRole).toEqual(
      expect.arrayContaining([
        { role: 'ADMIN', count: 1 },
        { role: 'MEMBER', count: 2 },
      ]),
    );
    expect(body.usersByRole.length).toBe(2);
  });

  it('returns GLOBAL-scoped metrics for VELA_ADMIN, with an exact per-tenant breakdown for an isolated tenant', async () => {
    const slug = `metrics-global-${Date.now()}`;
    createdTenantSlugs.push(slug);
    const isolatedTenant = await prisma.tenant.create({ data: { name: 'Metrics Global Co', slug } });

    const email = `metrics-global-user-${Date.now()}@example.com`;
    createdUserEmails.push(email);
    await prisma.user.create({
      data: { email, passwordHash: 'irrelevant-for-this-test', tenantId: isolatedTenant.id },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/dashboard',
      cookies: { token: velaAdminToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.scope).toBe('GLOBAL');
    expect(typeof body.totalTenants).toBe('number');
    expect(typeof body.totalUsers).toBe('number');
    expect(body.totalTenants).toBeGreaterThan(0);
    expect(body.totalUsers).toBeGreaterThan(0);
    expect(body.recentSignups.length).toBeLessThanOrEqual(5);

    const ourEntry = (
      body.usersByTenant as Array<{
        tenantId: string;
        tenantName: string;
        tenantSlug: string;
        userCount: number;
      }>
    ).find((entry) => entry.tenantId === isolatedTenant.id);

    expect(ourEntry).toEqual({
      tenantId: isolatedTenant.id,
      tenantName: 'Metrics Global Co',
      tenantSlug: slug,
      userCount: 1,
    });
  });

  it('orders recentSignups by createdAt descending', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/metrics/dashboard',
      cookies: { token: velaAdminToken },
    });

    const body = response.json();
    const timestamps = (body.recentSignups as Array<{ createdAt: string }>).map((user) =>
      new Date(user.createdAt).getTime(),
    );
    const sortedDescending = [...timestamps].sort((a, b) => b - a);

    expect(timestamps).toEqual(sortedDescending);
  });
});
