import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { errorResponseSchema, validationErrorResponseSchema, userPublicSchema, withDescription } from '../lib/schemas.js';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
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
};
