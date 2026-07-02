import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { verifyAdmin } from '../lib/auth.js';
import { errorResponseSchema, validationErrorResponseSchema, userPublicSchema, withDescription } from '../lib/schemas.js';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  tenantId: z.string().uuid(),
});

const userWithTenantSchema = userPublicSchema.extend({
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
  }),
});

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/users',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Create a new user',
        description: 'Admin only. Creates a user under the given tenant. Never returns the password hash.',
        security: [{ cookieAuth: [] }],
        body: createUserBodySchema,
        response: {
          201: withDescription(userPublicSchema, 'User created successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
          409: withDescription(errorResponseSchema, 'A user with this email already exists'),
          500: withDescription(errorResponseSchema, 'Unexpected server error, e.g. tenantId does not reference an existing tenant'),
        },
      },
    },
    async (request, reply) => {
      const { email, password, tenantId } = request.body;

      const passwordHash = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: { email, passwordHash, tenantId },
        select: {
          id: true,
          email: true,
          role: true,
          tenantId: true,
          createdAt: true,
        },
      });

      return reply.status(201).send(user);
    },
  );

  app.get(
    '/users',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Users'],
        summary: 'List users',
        description:
          'Admin only (MEMBER gets 403). VELA_ADMIN sees every user across every tenant; ' +
          'ADMIN sees only users in their own tenant. Each user includes its tenant name and slug.',
        security: [{ cookieAuth: [] }],
        response: {
          200: withDescription(z.array(userWithTenantSchema), 'List of users, scoped by role'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
        },
      },
    },
    async (request, reply) => {
      const { role, tenantId } = request.user;

      const users = await prisma.user.findMany({
        where: role === 'VELA_ADMIN' ? {} : { tenantId },
        select: {
          id: true,
          email: true,
          role: true,
          tenantId: true,
          createdAt: true,
          tenant: {
            select: { name: true, slug: true },
          },
        },
      });

      return reply.send(users);
    },
  );
};
