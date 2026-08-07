// @ts-check
import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'vite.config.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite(),
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript already reports undefined identifiers with full knowledge
      // of DOM/lib globals; no-undef re-checks against ESLint's own (smaller)
      // global list and produces false positives on window/document/etc.
      'no-undef': 'off',

      // Stray debug logging is how gate codes and passcodes end up
      // somewhere they shouldn't (plan W32). No exceptions yet — a future
      // logging module gets a files-scoped override when it exists.
      'no-console': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],

      // Plan W27: the access token lives in memory only and the refresh
      // token in sessionStorage; localStorage is banned outright, by any
      // spelling, so a future edit cannot reintroduce it by accident.
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: 'localStorage is banned (plan W27) — use auth/session.ts.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: 'localStorage is banned (plan W27) — use auth/session.ts.',
        },
      ],

      // Plan W19: `new Date('2026-07-16')` parses as UTC midnight and
      // renders a day early for any negative-offset viewer. Date-only
      // strings are formatted directly in utils/dates.ts, never turned
      // into a Date.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'] > Literal[raw=/^['\"]/]:first-child",
          message:
            'Do not construct a Date from a string literal (plan W19) — format date-only strings directly in utils/dates.ts.',
        },
        {
          selector:
            "NewExpression[callee.name='Date'] > TemplateLiteral[expressions.length=0]:first-child",
          message:
            'Do not construct a Date from a string literal (plan W19) — format date-only strings directly in utils/dates.ts.',
        },
      ],
    },
  },
  {
    files: ['test/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: {
      // Test doubles and assertions on loosely-typed fixtures trip these
      // without catching anything real; production code under src/ keeps
      // them on (mirrors bearlake-server's test override).
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: ['test/setup.ts'],
    rules: {
      // This is the file that enforces the localStorage ban everywhere else
      // (plan W27) — it spies on window.localStorage specifically in order
      // to assert it's never called, which requires referencing it.
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['src/api/context.tsx', 'src/auth/AuthProvider.tsx'],
    rules: {
      // The plan's project structure (§4) colocates each Provider with its
      // hook in one file — the standard React Context pattern.
      // react-refresh/only-export-components is a Fast Refresh nicety
      // (preserving component state across hot reload), not a correctness
      // rule; splitting one Context into multiple files to satisfy it isn't
      // worth the fragmentation.
      'react-refresh/only-export-components': 'off',
    },
  },
);
