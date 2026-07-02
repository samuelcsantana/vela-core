import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { tenantRoutes } from './routes/tenant.routes.js';

const app = Fastify({
  logger: true,
});

app.register(cors, {
  origin: '*',
});

app.register(tenantRoutes, { prefix: '/api' });

app.get('/ping', async () => {
  return { status: 'ok' };
});

app.listen({ port: 3333 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});
