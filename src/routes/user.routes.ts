import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { verifyAdmin } from '../lib/auth.js';
import {
  errorResponseSchema,
  validationErrorResponseSchema,
  userPublicSchema,
  withDescription,
} from '../lib/schemas.js';
import { createUser, deleteUser, listUsers, updateUser } from '../services/user.service.js';

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

  const updateUserBodySchema = z.object({
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.enum(['ADMIN', 'MEMBER']).optional(),
    tenantId: z.string().uuid().optional(),
  });

  const userIdParamsSchema = z.object({
    id: z.string().uuid(),
  });

  app.patch(
    '/users/:id',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Update a user',
        description:
          'Admin only. Partially updates a user. VELA_ADMIN can edit any user; tenant ADMIN ' +
          'can only edit users in their own tenant. Only VELA_ADMIN can move a user to another tenant.',
        security: [{ cookieAuth: [] }],
        params: userIdParamsSchema,
        body: updateUserBodySchema,
        response: {
          200: withDescription(userPublicSchema, 'User updated successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Not authorized to edit this user'),
          404: withDescription(errorResponseSchema, 'No user matches the given id'),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      const user = await updateUser(request.user, request.params.id, request.body);

      return reply.send(user);
    },
  );

  app.delete(
    '/users/:id',
    {
      preHandler: [app.authenticate, verifyAdmin],
      schema: {
        tags: ['Users'],
        summary: 'Delete a user',
        description:
          'Admin only. Deletes a user. VELA_ADMIN can delete any user; tenant ADMIN can only ' +
          'delete users in their own tenant. Users cannot delete themselves.',
        security: [{ cookieAuth: [] }],
        params: userIdParamsSchema,
        response: {
          200: withDescription(z.object({ message: z.string() }), 'User deleted successfully'),
          401: withDescription(errorResponseSchema, 'Missing or invalid token cookie'),
          403: withDescription(errorResponseSchema, 'Not authorized to delete this user'),
          404: withDescription(errorResponseSchema, 'No user matches the given id'),
          500: withDescription(errorResponseSchema, 'Unexpected server error'),
        },
      },
    },
    async (request, reply) => {
      await deleteUser(request.user, request.params.id);

      return reply.status(200).send({ message: 'User deleted successfully' });
    },
  );
};
