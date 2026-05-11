import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Allow TypeScript source imports with `.js` extension (ESM-style).
    // Vitest rewrites `import './foo.js'` → `import './foo.ts'` during test runs.
    extensionOrder: ['.ts', '.js'],
  },
  test: {
    include: ['test/**/*.test.ts'],
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/adapters/**',
        'src/**/*.test.ts',
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 70,
        statements: 75,
      },
    },
  },
});
