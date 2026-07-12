import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['src/generated/**', 'src/tests/**', 'prisma/**', 'dist/**', '**/*.config.*'],
      thresholds: {
        lines: 85,
        functions: 80,
        branches: 65,
        statements: 85,
      },
    },
  },
});
