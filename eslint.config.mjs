import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

/**
 * Shared plugins and rules for the Sokosumi monorepo.
 * Can be composed with other configs without plugin conflicts.
 * Note: Does not include import plugin as Next.js provides its own.
 */
export const sharedPlugins = {
  "simple-import-sort": simpleImportSort,
  "unused-imports": unusedImports,
};

export const sharedRules = {
  // Import organization
  "simple-import-sort/imports": "error",
  "simple-import-sort/exports": "error",
  "unused-imports/no-unused-imports": "error",
  "import/first": "error",
  "import/newline-after-import": "error",
  "import/no-duplicates": "error",

  // TypeScript
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      varsIgnorePattern: "^_",
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
    },
  ],
};

/**
 * Base ESLint configuration for the Sokosumi monorepo.
 * Extended by individual packages with their specific needs.
 * For packages using Next.js, import sharedPlugins and sharedRules separately.
 */
const baseConfig = defineConfig([
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      ...sharedPlugins,
      import: importPlugin,
    },
    rules: sharedRules,
  },
]);

export default baseConfig;
