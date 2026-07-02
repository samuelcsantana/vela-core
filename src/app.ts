import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
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

  // Restricted to the known frontend origin, with credentials enabled so the
  // browser will send/receive the httpOnly JWT cookie on cross-origin requests.
  app.register(cors, { origin: 'http://localhost:3000', credentials: true });
  app.register(cookie);
  app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, generous for a logo image
  });
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
