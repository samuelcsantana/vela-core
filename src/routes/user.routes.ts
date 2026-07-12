import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { verifyAdmin } from '../lib/auth.js';
import {
  errorResponseSchema,
  validationErrorResponseSchema,
  userPublicSchema,
  withDescription,
} from '../lib/schemas.js';
import { createUser, listUsers } from '../services/user.service.js';

const createUserBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  // Required for VELA_ADMIN (which tenant is this user for?), but ignored
  // for a tenant ADMIN - see the RBAC comment in services/user.service.ts.
  // Optional here so an ADMIN caller isn't forced to send a value that won't
  // be used.
  tenantId: z.string().uuid().optional(),
  // VELA_ADMIN is deliberately not an assignable option: creating a root
  // account still requires direct database/seed access, not this endpoint.
  role: z.enum(['ADMIN', 'MEMBER']).optional(),
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
        description:
          'Admin only. Never returns the password hash. VELA_ADMIN may create a user for any ' +
          'tenantId with any role (ADMIN or MEMBER, default MEMBER). A tenant ADMIN can only ' +
          'create users in their own tenant - a tenantId in the payload is ignored and replaced ' +
          "with the caller's own tenantId, so one tenant's admin can never provision users in " +
          'another tenant.',
        security: [{ cookieAuth: [] }],
        body: createUserBodySchema,
        response: {
          201: withDescription(userPublicSchema, 'User created successfully'),
          400: withDescription(
            validationErrorResponseSchema,
            'Invalid request body, or tenantId missing while creating as VELA_ADMIN',
          ),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Authenticated user is not an admin'),
          409: withDescription(errorResponseSchema, 'A user with this email already exists'),
          500: withDescription(
            errorResponseSchema,
            'Unexpected server error, e.g. tenantId does not reference an existing tenant',
          ),
        },
      },
    },
    async (request, reply) => {
      const user = await createUser(request.user, request.body);

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
      const users = await listUsers(request.user);

      return reply.send(users);
    },
  );
};
