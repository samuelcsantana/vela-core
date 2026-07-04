import { buildApp } from './app.js';

const app = buildApp();

// host must be 0.0.0.0, not the default 127.0.0.1 - cloud platforms (e.g.
// Render) port-scan the container from outside its network namespace, so a
// server only bound to loopback is unreachable and fails the health check.
// PORT is assigned dynamically by the platform; 3333 is just the local dev
// fallback.
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Server listening at ${address}`);
});
