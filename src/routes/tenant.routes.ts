import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { verifyAdmin } from '../lib/auth.js';

const createTenantBodySchema = z.object({
  name: z.string(),
  slug: z.string(),
  primaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
});

const tenantSlugParamsSchema = z.object({
  slug: z.string(),
});

export async function tenantRoutes(app: FastifyInstance) {
  app.post('/tenants', { preHandler: [app.authenticate, verifyAdmin] }, async (request, reply) => {
    const { name, slug, primaryColor, logoUrl } = createTenantBodySchema.parse(request.body);

    const tenant = await prisma.tenant.create({
      data: { name, slug, primaryColor, logoUrl },
    });

    return reply.status(201).send(tenant);
  });

  app.get('/tenants', { preHandler: [app.authenticate] }, async (request, reply) => {
    const tenants = await prisma.tenant.findMany();

    return reply.send(tenants);
  });

  app.get('/tenants/:slug', async (request, reply) => {
    const { slug } = tenantSlugParamsSchema.parse(request.params);

    const tenant = await prisma.tenant.findUnique({ where: { slug } });

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' });
    }

    return reply.send(tenant);
  });
}
