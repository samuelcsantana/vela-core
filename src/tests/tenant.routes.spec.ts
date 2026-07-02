import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, seedBaseData, extractTokenCookie } from './helpers.js';

describe('Tenant routes - exception flows', () => {
  const app = buildApp();
  const createdTenantSlugs: string[] = [];
  let adminToken: string;

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });
    adminToken = extractTokenCookie(loginResponse);
  });

  afterAll(async () => {
    if (createdTenantSlugs.length > 0) {
      await prisma.tenant.deleteMany({ where: { slug: { in: createdTenantSlugs } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('lists tenants for an authenticated user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      cookies: { token: adminToken },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  it('lists public tenant fields without requiring auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants/public',
    });

    expect(response.statusCode).toBe(200);
    const tenants = response.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(tenants)).toBe(true);
    expect(tenants.some((tenant) => tenant.slug === 'vela')).toBe(true);

    const velaTenant = tenants.find((tenant) => tenant.slug === 'vela');
    expect(Object.keys(velaTenant!).sort()).toEqual(['id', 'name', 'slug']);
  });

  it('returns 404 for a slug that does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants/does-not-exist-slug',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Tenant not found' });
  });

  it('returns 400 for an invalid tenant creation payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { slug: `missing-name-${Date.now()}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 409 when the slug already exists', async () => {
    const slug = `conflict-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Conflict Co', slug },
    });
    expect(firstResponse.statusCode).toBe(201);

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Conflict Co Again', slug },
    });

    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toEqual({ error: 'Resource already exists' });
  });
});
