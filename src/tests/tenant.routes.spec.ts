import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { MAX_TENANTS_LIMIT } from '../routes/tenant.routes.js';
import { ADMIN_CREDENTIALS, GUEST_CREDENTIALS, seedBaseData, extractTokenCookie, buildTenantMultipart } from './helpers.js';

const { FAKE_LOGO_URL } = vi.hoisted(() => ({
  FAKE_LOGO_URL: 'https://vela-saas-portfolio-logos.s3.sa-east-1.amazonaws.com/logos/fake-logo.png',
}));

vi.mock('../lib/s3.js', () => ({
  uploadLogo: vi.fn().mockResolvedValue(FAKE_LOGO_URL),
}));

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
    const { payload, headers } = buildTenantMultipart({ slug: `missing-name-${Date.now()}` });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation error');
  });

  it('returns 409 when the slug already exists', async () => {
    const slug = `conflict-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const first = buildTenantMultipart({ name: 'Conflict Co', slug });
    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: first.headers,
      payload: first.payload,
    });
    expect(firstResponse.statusCode).toBe(201);

    const second = buildTenantMultipart({ name: 'Conflict Co Again', slug });
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: second.headers,
      payload: second.payload,
    });

    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toEqual({ error: 'Resource already exists' });
  });

  it('creates a tenant with a logo file, uploading it to S3', async () => {
    const slug = `with-logo-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const { payload, headers } = buildTenantMultipart(
      { name: 'Logo Co', slug },
      { buffer: Buffer.from('fake-png-bytes'), filename: 'logo.png', contentType: 'image/png' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().logoUrl).toBe(FAKE_LOGO_URL);
  });

  it('rejects a non-image file in the logo field', async () => {
    const { payload, headers } = buildTenantMultipart(
      { name: 'Bad Logo Co', slug: `bad-logo-${Date.now()}` },
      { buffer: Buffer.from('not-an-image'), filename: 'virus.exe', contentType: 'application/x-msdownload' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('logo must be an image file');
  });

  it('ignores a file part sent under an unexpected field name', async () => {
    const slug = `ignored-file-field-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const { payload, headers } = buildTenantMultipart(
      { name: 'Ignored File Co', slug },
      {
        buffer: Buffer.from('irrelevant'),
        filename: 'photo.png',
        contentType: 'image/png',
        fieldname: 'photo',
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().logoUrl).toBeNull();
  });

  it('updates a tenant as admin', async () => {
    const slug = `patch-target-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const create = buildTenantMultipart({ name: 'Patch Target Co', slug });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: create.headers,
      payload: create.payload,
    });
    const tenantId = createResponse.json().id;

    const patch = buildTenantMultipart({ name: 'Patched Name', primaryColor: '#123456' });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantId}`,
      cookies: { token: adminToken },
      headers: patch.headers,
      payload: patch.payload,
    });

    expect(patchResponse.statusCode).toBe(200);
    const body = patchResponse.json();
    expect(body.name).toBe('Patched Name');
    expect(body.primaryColor).toBe('#123456');
    expect(body.slug).toBe(slug);
  });

  it('updates a tenant logo, uploading the new file to S3', async () => {
    const slug = `patch-logo-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const create = buildTenantMultipart({ name: 'Patch Logo Co', slug });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: create.headers,
      payload: create.payload,
    });
    const tenantId = createResponse.json().id;

    const patch = buildTenantMultipart(
      {},
      { buffer: Buffer.from('fake-png-bytes'), filename: 'new-logo.png', contentType: 'image/png' },
    );
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantId}`,
      cookies: { token: adminToken },
      headers: patch.headers,
      payload: patch.payload,
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().logoUrl).toBe(FAKE_LOGO_URL);
  });

  it('allows re-submitting the same slug on the same tenant', async () => {
    const slug = `patch-same-slug-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const create = buildTenantMultipart({ name: 'Same Slug Co', slug });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: create.headers,
      payload: create.payload,
    });
    const tenantId = createResponse.json().id;

    const patch = buildTenantMultipart({ slug });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantId}`,
      cookies: { token: adminToken },
      headers: patch.headers,
      payload: patch.payload,
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json().slug).toBe(slug);
  });

  it('returns 404 when the tenant id does not exist', async () => {
    const { payload, headers } = buildTenantMultipart({ name: 'Nobody' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Tenant not found' });
  });

  it('returns 409 when the new slug belongs to another tenant', async () => {
    const slugA = `patch-conflict-a-${Date.now()}`;
    const slugB = `patch-conflict-b-${Date.now()}`;
    createdTenantSlugs.push(slugA, slugB);

    const tenantA = buildTenantMultipart({ name: 'Tenant A', slug: slugA });
    const tenantAResponse = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: tenantA.headers,
      payload: tenantA.payload,
    });
    const tenantAId = tenantAResponse.json().id;

    const tenantB = buildTenantMultipart({ name: 'Tenant B', slug: slugB });
    await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers: tenantB.headers,
      payload: tenantB.payload,
    });

    const patch = buildTenantMultipart({ slug: slugB });
    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/tenants/${tenantAId}`,
      cookies: { token: adminToken },
      headers: patch.headers,
      payload: patch.payload,
    });

    expect(patchResponse.statusCode).toBe(409);
    expect(patchResponse.json()).toEqual({ error: 'Another tenant already uses this slug' });
  });

  it('returns 403 when a non-admin tries to update a tenant', async () => {
    const { payload, headers } = buildTenantMultipart({ name: 'Nope' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      cookies: { token: guestToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 401 when updating a tenant without a token', async () => {
    const { payload, headers } = buildTenantMultipart({ name: 'Nope' });

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tenants/00000000-0000-0000-0000-000000000000',
      headers,
      payload,
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

    const { payload, headers } = buildTenantMultipart({ name: 'One Too Many', slug: `over-limit-${Date.now()}` });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      cookies: { token: adminToken },
      headers,
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: `Free tier limit reached. Maximum number of tenants allowed in this demo is ${MAX_TENANTS_LIMIT}.`,
    });
  });
});
