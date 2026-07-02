import { ZodError } from 'zod';
import type { FastifyInstance, FastifyError } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';

export function setupErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        issues: error.issues,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({ error: 'Resource already exists' });
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    request.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });
}
