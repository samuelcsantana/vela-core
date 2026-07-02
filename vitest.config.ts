import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'src/generated/**',
        'src/tests/**',
        'prisma/**',
        'dist/**',
        '**/*.config.*',
      ],
    },
  },
});
