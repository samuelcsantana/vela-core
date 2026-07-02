import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { errorResponseSchema, validationErrorResponseSchema, withDescription } from '../lib/schemas.js';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const loginResponseSchema = z.object({
  token: z.string(),
});

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log in',
        description: 'Public. Returns a JWT containing id, role and tenantId.',
        body: loginBodySchema,
        response: {
          200: withDescription(loginResponseSchema, 'Login successful, returns a signed JWT'),
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

      return reply.send({ token });
    },
  );
};
