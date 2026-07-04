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

  it('logs out by clearing the token cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });

    const clearedCookie = response.cookies.find((cookie) => cookie.name === 'token');
    expect(clearedCookie).toBeDefined();
    expect(clearedCookie?.value).toBe('');
  });
});

describe('Auth cookie attributes - cross-origin support', () => {
  const app = buildApp();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    await app.ready();
    await seedBaseData();
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await app.close();
    await prisma.$disconnect();
  });

  it('sets a Lax, non-Secure cookie outside production (Vercel/Render both use HTTPS, but local dev does not)', async () => {
    process.env.NODE_ENV = 'test';

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });

    const cookie = response.cookies.find((c) => c.name === 'token');
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.sameSite).toBe('Lax');
  });

  it('sets a None, Secure cookie in production so it survives the Vercel <-> Render cross-site request', async () => {
    process.env.NODE_ENV = 'production';

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: ADMIN_CREDENTIALS,
    });

    const cookie = response.cookies.find((c) => c.name === 'token');
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('None');
  });

  it('clears the cookie with the same Secure/SameSite attributes it was set with in production', async () => {
    process.env.NODE_ENV = 'production';

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    const cookie = response.cookies.find((c) => c.name === 'token');
    expect(cookie?.value).toBe('');
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('None');
  });
});
