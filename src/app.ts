import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
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
import { metricsRoutes } from './routes/metrics.routes.js';

// In development there's no FRONTEND_URL to read, so the frontend's known
// local origin is hardcoded. In production a wildcard or missing origin
// would let any site ride the browser's httpOnly auth cookie via CORS, so
// FRONTEND_URL is required - fail loudly at startup rather than silently
// falling back to something permissive. Comma-separated values allow more
// than one production origin (e.g. a staging and a prod frontend).
function resolveCorsOrigin(): string | string[] {
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000';
  }

  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL environment variable must be set when NODE_ENV=production');
  }

  const origins = frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length === 1 ? origins[0] : origins;
}

export function buildApp() {
  const app = Fastify({
    logger: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  setupErrorHandler(app);

  // Adds HSTS, X-Content-Type-Options, X-Frame-Options, etc. Content-Security-Policy
  // is disabled: this is a JSON API whose only HTML surface is the Swagger docs UI
  // (/docs), which needs inline scripts/styles that helmet's default CSP blocks -
  // and CSP's main value (mitigating injected-script XSS) doesn't apply to an API
  // that never renders arbitrary content anyway.
  app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Restricted to the known frontend origin, with credentials enabled so the
  // browser will send/receive the httpOnly JWT cookie on cross-origin requests.
  // @fastify/cors defaults `methods` to 'GET,HEAD,POST' only, which silently
  // blocked preflight requests for PATCH/DELETE (used by tenant update/delete).
  app.register(cors, {
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
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
  app.register(metricsRoutes, { prefix: '/api' });

  app.get('/ping', async () => {
    return { status: 'ok' };
  });

  return app;
}
