import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import { validatorCompiler, serializerCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { authPlugin } from './lib/auth.js';
import { swaggerPlugin } from './lib/swagger.js';
import { setupErrorHandler } from './lib/errorHandler.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { authRoutes } from './routes/auth.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  setupErrorHandler(app);

  // origin: '*' cannot be combined with credentials: true (browsers reject it),
  // and the JWT now travels as an httpOnly cookie, which requires credentialed
  // cross-origin requests. Reflecting the request origin keeps the previous
  // "any origin" openness while making cookie auth actually work.
  app.register(cors, { origin: true, credentials: true });
  app.register(cookie);
  app.register(sensible);
  app.register(authPlugin);

  // Registered before the API routes so its onRoute hook captures every endpoint.
  app.register(swaggerPlugin);

  app.register(tenantRoutes, { prefix: '/api' });
  app.register(userRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });

  app.get('/ping', async () => {
    return { status: 'ok' };
  });

  return app;
}
