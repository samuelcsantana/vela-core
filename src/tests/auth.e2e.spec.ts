import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, GUEST_CREDENTIALS, seedBaseData } from './helpers.js';

const FORBIDDEN_MESSAGE = 'Access denied. Only administrators can perform this action.';

describe('Auth & RBAC (e2e)', () => {
  const app = buildApp();
  const createdTenantSlugs: string[] = [];

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();
  });

  afterAll(async () => {
    if (createdTenantSlugs.length > 0) {
      await prisma.tenant.deleteMany({ where: { slug: { in: createdTenantSlugs } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('logs in successfully with valid guest credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: GUEST_CREDENTIALS,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().token).toBeUndefined();
    expect(response.json().email).toBe(GUEST_CREDENTIALS.email);

    const tokenCookie = response.cookies.find((cookie) => cookie.name === 'token');
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.value).toEqual(expect.any(String));
    expect(tokenCookie?.httpOnly).toBe(true);
    expect(tokenCookie?.path).toBe('/');
  });

  it('blocks a guest (MEMBER) from creating a tenant', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: GUEST_CREDENTIALS,
    });
    const token = loginResponse.cookies.find((cookie) => cookie.name === 'token')?.value;

    const slug = `guest-blocked-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: token! },
      payload: { name: 'Should Not Exist', slug },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe(FORBIDDEN_MESSAGE);
  });

  it('allows an admin to create a tenant', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });
    const token = loginResponse.cookies.find((cookie) => cookie.name === 'token')?.value;

    const slug = `teste-admin-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: token! },
      payload: { name: 'Teste Admin Co', slug },
    });

    expect(response.statusCode).toBe(201);
  });

  it('rejects a request with no token cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants',
    });

    expect(response.statusCode).toBe(401);
  });
});
