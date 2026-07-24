import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // web/public/tesseract is the vendored OCR runtime (minified upstream bundles) — not ours to lint.
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', 'scripts/**', 'web/public/tesseract/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
);
