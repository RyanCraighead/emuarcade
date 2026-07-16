import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'src/shared/emulator.ts',
        'src/shared/trpc.ts',
        'src/shared/sharedState.ts',
        'src/client/gameLibrary.ts',
        'src/client/playStats.ts',
        'src/client/romIdentity.ts',
        'src/client/romMetadata.ts',
        'src/server/clips.ts',
        'src/server/shares.ts',
        'src/server/core/post.ts',
        'src/server/routes/menu.ts',
        'src/server/routes/triggers.ts',
      ],
      thresholds: {
        branches: 75,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
});
