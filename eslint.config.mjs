import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.expo/**',
      '.data/**',
      'dist/**',
      '**/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'apps/mobile/**/*.ts', 'apps/mobile/**/*.tsx'],
    ignores: ['apps/web/next.config.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/api/**', '**/worker/**', '@prisma/*', 'pg', 'node:*'],
              message:
                'Clients must use public API contracts; never import server persistence or IO.',
            },
          ],
        },
      ],
    },
  },
);
