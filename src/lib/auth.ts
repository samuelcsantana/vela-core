import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface JwtPayload {
  id: string;
  role: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.register(jwt, {
    secret: process.env.JWT_SECRET!,
    cookie: {
      cookieName: 'token',
      signed: false,
    },
    // Only read the token from the cookie set at login — the Authorization
    // header is no longer accepted, since the JWT now lives in an httpOnly
    // cookie for XSS protection.
    verify: {
      onlyCookie: true,
    },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });
});

export async function verifyAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.user.role !== 'ADMIN') {
    return reply.status(403).send({
      error: 'Access denied. Only administrators can perform this action.',
    });
  }
}
