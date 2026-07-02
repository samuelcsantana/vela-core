import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { authPlugin } from './lib/auth.js';
import { swaggerPlugin } from './lib/swagger.js';
import { setupErrorHandler } from './lib/errorHandler.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { authRoutes } from './routes/auth.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  setupErrorHandler(app);

  app.register(cors, { origin: '*' });
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
