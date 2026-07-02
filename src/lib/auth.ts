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
      error: 'Acesso negado. Apenas administradores podem realizar esta ação.',
    });
  }
}
