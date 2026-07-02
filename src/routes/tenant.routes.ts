import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { prisma } from '../lib/prisma.js';
import { verifyAdmin } from '../lib/auth.js';
import { errorResponseSchema, validationErrorResponseSchema, withDescription } from '../lib/schemas.js';

const createTenantBodySchema = z.object({
  name: z.string(),
  slug: z.string(),
  primaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
});

const tenantSlugParamsSchema = z.object({
  slug: z.string(),
});

const tenantResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  primaryColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  createdAt: z.date(),
});

const tenantPublicListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});

export const tenantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/tenants',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Tenants'],
        summary: 'Create a new tenant',
        description: 'Admin only. Creates a new tenant company.',
        security: [{ cookieAuth: [] }],
        body: createTenantBodySchema,
        response: {
          201: withDescription(tenantResponseSchema, 'Tenant created successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
          409: withDescription(errorResponseSchema, 'A tenant with this slug already exists'),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      const { name, slug, primaryColor, logoUrl } = request.body;

      const tenant = await prisma.tenant.create({
        data: { name, slug, primaryColor, logoUrl },
      });

      return reply.status(201).send(tenant);
    },
  );

  app.get(
    '/tenants',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Tenants'],
        summary: 'List all tenants',
        description: 'Any authenticated user can list tenants.',
        security: [{ cookieAuth: [] }],
        response: {
          200: withDescription(z.array(tenantResponseSchema), 'List of tenants'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
        },
      },
    },
    async (request, reply) => {
      const tenants = await prisma.tenant.findMany();

      return reply.send(tenants);
    },
  );

  app.get(
    '/tenants/public',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'List tenants (public, minimal fields)',
        description:
          'Public. Returns only non-sensitive fields (id, name, slug) for every tenant, ' +
          'to populate the tenant picker on the registration screen.',
        response: {
          200: withDescription(z.array(tenantPublicListItemSchema), 'List of tenants (public fields only)'),
        },
      },
    },
    async (request, reply) => {
      const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true },
      });

      return reply.send(tenants);
    },
  );

  app.get(
    '/tenants/:slug',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'Get a tenant by slug',
        description: 'Public white-label lookup, used to fetch branding before login.',
        params: tenantSlugParamsSchema,
        response: {
          200: withDescription(tenantResponseSchema, 'Tenant found'),
          404: withDescription(errorResponseSchema, 'No tenant matches the given slug'),
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params;

      const tenant = await prisma.tenant.findUnique({ where: { slug } });

      if (!tenant) {
        return reply.status(404).send({ error: 'Tenant not found' });
      }

      return reply.send(tenant);
    },
  );
};
