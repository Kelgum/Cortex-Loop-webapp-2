import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'Control_Tower/**',
            '.agent/**',
            '.agents/**',
        ],
    },
    js.configs.recommended,
    {
        files: ['**/*.{ts,js,mjs,cjs}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 2020,
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-unused-vars': 'off',
            'no-undef': 'off',
            'no-useless-assignment': 'off',
            'no-empty': 'off',
            'no-useless-catch': 'off',
            'preserve-caught-error': 'off',
            'no-console': 'warn',
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
    {
        files: [
            'scripts/**/*.{js,mjs}',
            'tests/**/*.{ts,js}',
            'vite.config.ts',
            'playwright.config.ts',
            'vitest.config.ts',
        ],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-console': 'off',
        },
    },
];
