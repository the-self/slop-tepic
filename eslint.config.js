// eslint.config.js — the TypeScript is linted with typescript-eslint's strictest type-aware presets
// (strictTypeChecked + stylisticTypeChecked); the plain JavaScript left (tests, geodata tools) with the recommended rules.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['dist/', '**/node_modules/', 'js/world/city-geodata.js', 'tools/data/', '.claude/'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Template strings build CSS sizes, labels and cache keys out of numbers all over the HUD and the world builders
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Unused bindings are compile errors already (noUnusedLocals / noUnusedParameters); `_name` marks one kept on purpose
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    files: ['js/**/*.ts', 'shared/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['server/**/*.ts', 'tools/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
