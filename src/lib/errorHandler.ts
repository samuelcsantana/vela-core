import { ZodError } from 'zod';
import type { FastifyInstance, FastifyError } from 'fastify';
import { Prisma } from '../generated/prisma/client.js';
import { DomainError } from '../services/errors.js';

export function setupErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation error',
        issues: error.validation,
      });
    }

    // Multipart routes (POST/PATCH /tenants with a logo upload) can't use
    // Fastify's schema-based body validation, so they call zod .parse()
    // manually and rely on this branch for a consistent 400 response.
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        issues: error.issues,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.status(409).send({ error: 'Resource already exists' });
    }

    // Business-rule failures thrown by the service layer. Checked before the
    // generic statusCode branch because some domain errors carry a payload
    // beyond { error } (e.g. TenantHasUsersError includes userCount).
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send(error.toResponse());
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    request.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });
}
