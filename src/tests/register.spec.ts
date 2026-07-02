import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, seedBaseData } from './helpers.js';

describe('POST /api/auth/register', () => {
  const app = buildApp();
  const createdTenantSlugs: string[] = [];
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();
  });

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    if (createdTenantSlugs.length > 0) {
      await prisma.tenant.deleteMany({ where: { slug: { in: createdTenantSlugs } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('registers a new tenant and its admin user without requiring auth', async () => {
    const slug = `onboard-${Date.now()}`;
    const email = `owner-${Date.now()}@example.com`;
    createdTenantSlugs.push(slug);
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { companyName: 'Onboard Co', slug, email, password: 'secret123' },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.tenantId).toEqual(expect.any(String));
    expect(body.userId).toEqual(expect.any(String));
    expect(body.password).toBeUndefined();

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    expect(tenant).not.toBeNull();
    expect(tenant?.id).toBe(body.tenantId);
    expect(tenant?.name).toBe('Onboard Co');

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).not.toBeNull();
    expect(user?.id).toBe(body.userId);
    expect(user?.role).toBe('ADMIN');
    expect(user?.tenantId).toBe(body.tenantId);
  });

  it('returns 409 when the slug already exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companyName: 'Duplicate Slug Co',
        slug: 'vela',
        email: `dup-slug-${Date.now()}@example.com`,
        password: 'secret123',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('A tenant with this slug already exists');
  });

  it('returns 409 when the email already exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        companyName: 'Duplicate Email Co',
        slug: `dup-email-${Date.now()}`,
        email: ADMIN_CREDENTIALS.email,
        password: 'secret123',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('A user with this email already exists');
  });

  it('returns 400 for an invalid request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { slug: `invalid-${Date.now()}` },
    });

    expect(response.statusCode).toBe(400);
  });
});
