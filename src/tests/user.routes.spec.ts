import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, GUEST_CREDENTIALS, seedBaseData, extractTokenCookie } from './helpers.js';

describe('User routes - exception flows', () => {
  const app = buildApp();
  const createdUserEmails: string[] = [];
  let adminToken: string;
  let guestToken: string;
  let tenantId: string;

  beforeAll(async () => {
    await app.ready();
    const tenant = await seedBaseData();
    tenantId = tenant.id;

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
  });

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
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

  it('returns 500 when the referenced tenant does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies: { token: adminToken },
      payload: {
        email: `orphan-${Date.now()}@vela.com`,
        password: 'secret123',
        tenantId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.statusCode).toBe(500);
  });

  it('lists users scoped to the caller tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: { token: guestToken },
    });

    expect(response.statusCode).toBe(200);
    const users = response.json() as Array<{ tenantId: string }>;
    expect(Array.isArray(users)).toBe(true);
    expect(users.every((user) => user.tenantId === tenantId)).toBe(true);
  });
});
