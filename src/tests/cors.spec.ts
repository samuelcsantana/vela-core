import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../app.js';

describe('CORS origin resolution', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('falls back to http://localhost:3000 outside production', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.FRONTEND_URL;

    const app = buildApp();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:3000' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    await app.close();
  });

  it('throws at startup in production when FRONTEND_URL is not set', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;

    expect(() => buildApp()).toThrow(
      'FRONTEND_URL environment variable must be set when NODE_ENV=production',
    );
  });

  it('restricts CORS to a single FRONTEND_URL origin in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.vela-demo.com';

    const app = buildApp();
    await app.ready();

    // A single configured string origin is a fixed allowlist of one: the
    // Access-Control-Allow-Origin header is always this exact value, no
    // matter what Origin the request declares - the browser is what refuses
    // to accept the response if its own origin doesn't match this header,
    // not the server doing per-request matching.
    const response = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://app.vela-demo.com');

    await app.close();
  });

  it('accepts a comma-separated FRONTEND_URL as multiple allowed origins in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.vela-demo.com, https://staging.vela-demo.com';

    const app = buildApp();
    await app.ready();

    const first = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://app.vela-demo.com' },
    });
    expect(first.headers['access-control-allow-origin']).toBe('https://app.vela-demo.com');

    const second = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'https://staging.vela-demo.com' },
    });
    expect(second.headers['access-control-allow-origin']).toBe('https://staging.vela-demo.com');

    await app.close();
  });
});
