import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';

export const swaggerPlugin = fp(async (app: FastifyInstance) => {
  await app.register(swagger, {
    transform: jsonSchemaTransform,
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Vela Core API',
        version: '1.0.0',
        description: 'Multi-tenant SaaS API with RBAC',
      },
      components: {
        securitySchemes: {
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'token',
            description: 'JWT set as an httpOnly cookie by POST /api/auth/login',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });
});
