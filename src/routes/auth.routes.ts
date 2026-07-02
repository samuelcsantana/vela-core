import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { errorResponseSchema, validationErrorResponseSchema, userPublicSchema, withDescription } from '../lib/schemas.js';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const logoutResponseSchema = z.object({
  message: z.string(),
});

const registerBodySchema = z.object({
  companyName: z.string(),
  slug: z.string(),
  email: z.string().email(),
  password: z.string().min(6),
});

const registerResponseSchema = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log in',
        description:
          'Public. Sets a signed JWT (id, role, tenantId) as an httpOnly cookie and returns the user.',
        body: loginBodySchema,
        response: {
          200: withDescription(userPublicSchema, 'Login successful. Sets the token cookie and returns the user'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          401: withDescription(errorResponseSchema, 'Email not found or password does not match'),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        return reply.unauthorized('Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(password, user.passwordHash);

      if (!isValidPassword) {
        return reply.unauthorized('Invalid credentials');
      }

      const token = app.jwt.sign({
        id: user.id,
        role: user.role,
        tenantId: user.tenantId,
      });

      reply.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });

      return reply.send({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        createdAt: user.createdAt,
      });
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log out',
        description: 'Clears the httpOnly token cookie.',
        response: {
          200: withDescription(logoutResponseSchema, 'Logged out successfully'),
        },
      },
    },
    async (request, reply) => {
      reply.clearCookie('token', { path: '/' });

      return reply.status(200).send({ message: 'Logged out successfully' });
    },
  );

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Register a new tenant',
        description:
          'Public. Creates a Tenant and its first ADMIN user in a single transaction. ' +
          'Does not log in automatically — use POST /auth/login afterwards.',
        body: registerBodySchema,
        response: {
          201: withDescription(registerResponseSchema, 'Tenant and admin user created successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          409: withDescription(
            errorResponseSchema,
            'A tenant with this slug or a user with this email already exists',
          ),
        },
      },
    },
    async (request, reply) => {
      const { companyName, slug, email, password } = request.body;

      const [existingTenant, existingUser] = await Promise.all([
        prisma.tenant.findUnique({ where: { slug } }),
        prisma.user.findUnique({ where: { email } }),
      ]);

      if (existingTenant) {
        return reply.status(409).send({ error: 'A tenant with this slug already exists' });
      }

      if (existingUser) {
        return reply.status(409).send({ error: 'A user with this email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const { tenant, user } = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: companyName, slug },
        });

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: 'ADMIN',
            tenantId: tenant.id,
          },
        });

        return { tenant, user };
      });

      return reply.status(201).send({ tenantId: tenant.id, userId: user.id });
    },
  );
};
