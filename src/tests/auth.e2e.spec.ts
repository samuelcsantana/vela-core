import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const GUEST_CREDENTIALS = { email: 'guest@vela.com', password: 'guest123' };
const ADMIN_CREDENTIALS = { email: 'admin@vela.com', password: 'admin123' };

const FORBIDDEN_MESSAGE = 'Acesso negado. Apenas administradores podem realizar esta ação.';

describe('Auth & RBAC (e2e)', () => {
  const app = buildApp();
  const createdTenantSlugs: string[] = [];

  beforeAll(async () => {
    await app.ready();

    const tenant = await prisma.tenant.upsert({
      where: { slug: 'vela' },
      update: {},
      create: { slug: 'vela', name: 'Vela Admin' },
    });

    await prisma.user.upsert({
      where: { email: ADMIN_CREDENTIALS.email },
      update: {},
      create: {
        email: ADMIN_CREDENTIALS.email,
        passwordHash: await bcrypt.hash(ADMIN_CREDENTIALS.password, 10),
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });

    await prisma.user.upsert({
      where: { email: GUEST_CREDENTIALS.email },
      update: {},
      create: {
        email: GUEST_CREDENTIALS.email,
        passwordHash: await bcrypt.hash(GUEST_CREDENTIALS.password, 10),
        role: 'MEMBER',
        tenantId: tenant.id,
      },
    });
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
    expect(response.json().token).toEqual(expect.any(String));
  });

  it('blocks a guest (MEMBER) from creating a tenant', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: GUEST_CREDENTIALS,
    });
    const { token } = loginResponse.json();

    const slug = `guest-blocked-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      headers: { authorization: `Bearer ${token}` },
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
    const { token } = loginResponse.json();

    const slug = `teste-admin-${Date.now()}`;
    createdTenantSlugs.push(slug);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tenants',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Teste Admin Co', slug },
    });

    expect(response.statusCode).toBe(201);
  });
});
