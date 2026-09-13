import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * A lint gate for the API, where there was none.
 *
 * Deliberately not type-aware (`recommendedTypeChecked`): that needs a full
 * program per run and would make the gate slow enough that people stop running
 * it. `tsc --noEmit` already covers the type questions; what this adds is the
 * class of mistake the compiler is happy with — unused imports, floating
 * promises' cheaper cousins, unreachable branches.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/generated/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `scripts/*.js` are plain CommonJS Node utilities run with `node`, not
    // part of the TypeScript build. Without this they collect an error per
    // `require`, per `process` and per `console` — noise that would bury the
    // findings that matter.
    files: ['scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', process: 'readonly', console: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    rules: {
      // The Prisma and Express boundaries deal in `unknown` and `any` in
      // places the code narrows on purpose. Worth seeing, not worth blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // Express error middleware must declare four parameters to be
          // recognised as error middleware at all, so the unused ones before a
          // used one are load-bearing rather than dead.
          args: 'after-used',
        },
      ],
    },
  }
);
