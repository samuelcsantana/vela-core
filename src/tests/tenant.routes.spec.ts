import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { MAX_TENANTS_LIMIT } from '../routes/tenant.routes.js';
import { ADMIN_CREDENTIALS, GUEST_CREDENTIALS, seedBaseData, extractTokenCookie } from './helpers.js';

describe('Tenant routes - exception flows', () => {
  const app = buildApp();
  const createdTenantSlugs: string[] = [];
  let adminToken: string;
  let guestToken: string;

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });
    adminToken = extractTokenCookie(loginResponse);

    const guestLoginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: GUEST_CREDENTIALS,
    });
    guestToken = extractTokenCookie(guestLoginResponse);
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

  it('updates a tenant as admin', async () => {
    const slug = `patch-target-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Patch Target Co', slug },
    });
    const tenantId = createResponse.json().id;

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantId}`,
      cookies: { token: adminToken },
      payload: { name: 'Patched Name', primaryColor: '#123456' },
    });

    expect(patchResponse.statusCode).toBe(200);
    const body = patchResponse.json();
    expect(body.name).toBe('Patched Name');
    expect(body.primaryColor).toBe('#123456');
    expect(body.slug).toBe(slug);
  });

  it('allows re-submitting the same slug on the same tenant', async () => {
    const slug = `patch-same-slug-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Same Slug Co', slug },
    });
    const tenantId = createResponse.json().id;

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantId}`,
      cookies: { token: adminToken },
      payload: { slug },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().slug).toBe(slug);
  });

  it('returns 404 when the tenant id does not exist', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      cookies: { token: adminToken },
      payload: { name: 'Nobody' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Tenant not found' });
  });

  it('returns 409 when the new slug belongs to another tenant', async () => {
    const slugA = `patch-conflict-a-${Date.now()}`;
    const slugB = `patch-conflict-b-${Date.now()}`;
    createdTenantSlugs.push(slugA, slugB);

    const tenantAResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Tenant A', slug: slugA },
    });
    const tenantAId = tenantAResponse.json().id;

    await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'Tenant B', slug: slugB },
    });

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantAId}`,
      cookies: { token: adminToken },
      payload: { slug: slugB },
    });

    expect(patchResponse.statusCode).toBe(409);
    expect(patchResponse.json()).toEqual({ error: 'Another tenant already uses this slug' });
  });

  it('returns 403 when a non-admin tries to update a tenant', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      cookies: { token: guestToken },
      payload: { name: 'Nope' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 401 when updating a tenant without a token', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      payload: { name: 'Nope' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when the free tier tenant limit is reached', async () => {
    const currentCount = await prisma.tenant.count();
    const missing = Math.max(MAX_TENANTS_LIMIT - currentCount, 0);

    if (missing > 0) {
      const fillerSlugs = Array.from({ length: missing }, (_, i) => `limit-filler-${Date.now()}-${i}`);
      createdTenantSlugs.push(...fillerSlugs);

      await prisma.tenant.createMany({
        data: fillerSlugs.map((slug) => ({ name: 'Filler Co', slug })),
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      payload: { name: 'One Too Many', slug: `over-limit-${Date.now()}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: `Free tier limit reached. Maximum number of tenants allowed in this demo is ${MAX_TENANTS_LIMIT}.`,
    });
  });
});
