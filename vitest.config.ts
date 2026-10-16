import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: { NODE_ENV: 'test', REGISTER_PER_HOUR: '1000' },
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
