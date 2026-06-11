import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      'vscode': path.resolve(__dirname, './src/__tests__/mocks/vscode.ts')
    },
    include: ['src/__tests__/**/*.test.ts']
  }
});
