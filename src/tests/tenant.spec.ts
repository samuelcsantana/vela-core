import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

describe('GET /api/tenants/:slug', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();

    await prisma.tenant.upsert({
      where: { slug: 'sicredi' },
      update: { name: 'Sicredi' },
      create: { slug: 'sicredi', name: 'Sicredi' },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('returns 200 and the tenant data for an existing slug', async () => {
    const response = await supertest(app.server).get('/api/tenants/sicredi');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('Sicredi');
  });
});
