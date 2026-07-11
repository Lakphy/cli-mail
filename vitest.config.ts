import { defineConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
        'src/auth/**.ts': {
          statements: 70,
          branches: 65,
          functions: 70,
          lines: 70,
        },
        'src/config/store.ts': {
          statements: 70,
          branches: 60,
          functions: 75,
          lines: 70,
        },
        'src/utils/http.ts': {
          statements: 65,
          branches: 60,
          functions: 65,
          lines: 65,
        },
        'src/output/formatter.ts': {
          statements: 75,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
})
