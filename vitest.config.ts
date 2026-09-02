import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      all: true,
      include: [
        'src/index.ts',
        'src/lib/easing.ts',
        'src/lib/textureSequence.ts',
        'src/lib/utils.ts',
        'src/lib/events/**/*.ts',
        'src/lib/services/assets/assetService.ts',
        'src/lib/services/transition/transitionService.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 85,
        lines: 90,
      },
    },
  },
});
