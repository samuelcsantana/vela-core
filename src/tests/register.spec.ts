import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, seedBaseData } from './helpers.js';

describe('POST /api/auth/register', () => {
  const app = buildApp();
  const createdUserEmails: string[] = [];
  let tenantId: string;

  beforeAll(async () => {
    await app.ready();
    const tenant = await seedBaseData();
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  it('registers a MEMBER user under an existing tenant without requiring auth', async () => {
    const email = `member-${Date.now()}@example.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'secret123', tenantId },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json();
    expect(body.id).toEqual(expect.any(String));
    expect(body.email).toBe(email);
    expect(body.role).toBe('MEMBER');
    expect(body.tenantId).toBe(tenantId);
    expect(body.password).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('MEMBER');
  });

  it('ignores a client-supplied ADMIN role and forces MEMBER (privilege escalation guard)', async () => {
    const email = `escalation-attempt-${Date.now()}@example.com`;
    createdUserEmails.push(email);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'secret123', tenantId, role: 'ADMIN' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().role).toBe('MEMBER');

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('MEMBER');
  });

  it('returns 409 when the email already exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ADMIN_CREDENTIALS.email, password: 'secret123', tenantId },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('A user with this email already exists');
  });

  it('returns 400 for an invalid request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', password: 'secret123' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 500 when tenantId does not reference an existing tenant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: `orphan-${Date.now()}@example.com`,
        password: 'secret123',
        tenantId: '00000000-0000-0000-0000-000000000000',
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
