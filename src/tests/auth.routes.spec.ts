import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { ADMIN_CREDENTIALS, seedBaseData } from './helpers.js';

describe('Auth routes - failure flows', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects login with an email that does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@vela.com', password: 'whatever123' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid credentials');
  });

  it('rejects login with a wrong password for an existing user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN_CREDENTIALS.email, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid credentials');
  });

  it('rejects a request carrying a malformed token cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      cookies: { token: 'not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('ignores a bearer token in the Authorization header (cookie-only auth)', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });
    const token = loginResponse.cookies.find((cookie) => cookie.name === 'token')?.value;

    const response = await app.inject({
      method: 'GET',
      url: '/api/tenants',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });
});
