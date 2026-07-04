import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { errorResponseSchema, validationErrorResponseSchema, userPublicSchema, roleSchema, withDescription } from '../lib/schemas.js';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const logoutResponseSchema = z.object({
  message: z.string(),
});

const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  tenantId: z.string().uuid(),
  // Accepted for API contract compatibility with the tenant picker flow, but
  // intentionally ignored by the handler below — see the comment there.
  role: roleSchema.optional(),
});

// Frontend (Vercel) and backend (Render) live on different domains, so this
// is a cross-site request as far as the browser is concerned. SameSite=Lax
// (the default) is dropped from cross-site requests entirely, which is
// exactly why login returned 200 but every following request came back 401
// - the cookie was set but never sent back. SameSite=None is required to
// allow it cross-site, but browsers reject SameSite=None unless Secure is
// also set. Locally there's no HTTPS and both sides share localhost, so dev
// keeps Lax/non-Secure the way it always worked. logout must clear the
// cookie with these same attributes - clearing with mismatched
// Secure/SameSite doesn't reliably remove a cookie that was set with them.
// Read at call time, not module load time, so it reflects NODE_ENV as of
// each request rather than freezing whatever it was when this module first
// loaded.
function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    path: '/',
  };
}

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

      reply.cookie('token', token, getAuthCookieOptions());

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
      reply.clearCookie('token', getAuthCookieOptions());

      return reply.status(200).send({ message: 'Logged out successfully' });
    },
  );

  app.post(
    '/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Register a user under an existing tenant',
        description:
          'Public. Joins an existing tenant (picked via GET /tenants/public) as a MEMBER. ' +
          'The role field is ignored server-side — self-registered users are always MEMBER; ' +
          'promoting someone to ADMIN requires an authenticated admin via POST /users. ' +
          'Does not log in automatically — use POST /auth/login afterwards.',
        body: registerBodySchema,
        response: {
          201: withDescription(userPublicSchema, 'User created successfully'),
          400: withDescription(validationErrorResponseSchema, 'Invalid request body'),
          409: withDescription(errorResponseSchema, 'A user with this email already exists'),
          500: withDescription(errorResponseSchema, 'Unexpected server error, e.g. tenantId does not reference an existing tenant'),
        },
      },
    },
    async (request, reply) => {
      const { email, password, tenantId } = request.body;

      const existingUser = await prisma.user.findUnique({ where: { email } });

      if (existingUser) {
        return reply.status(409).send({ error: 'A user with this email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      // role is never taken from the request body: this is a public,
      // unauthenticated endpoint, so trusting a client-supplied role would let
      // anyone self-assign ADMIN on any tenant (tenant ids are public via
      // GET /tenants/public). Self-registration is always MEMBER.
      const user = await prisma.user.create({
        data: { email, passwordHash, tenantId, role: 'MEMBER' },
      });

      return reply.status(201).send({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        createdAt: user.createdAt,
      });
    },
  );
};
