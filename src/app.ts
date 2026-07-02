import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { authPlugin } from './lib/auth.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { userRoutes } from './routes/user.routes.js';
import { authRoutes } from './routes/auth.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.register(cors, { origin: '*' });
  app.register(sensible);
  app.register(authPlugin);

  app.register(tenantRoutes, { prefix: '/api' });
  app.register(userRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api' });

  app.get('/ping', async () => {
    return { status: 'ok' };
  });

  return app;
}
