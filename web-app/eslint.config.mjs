import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintNextPlugin from "eslint-config-next";
import prettier from "eslint-config-prettier/flat";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import noRelativeImportPaths from "eslint-plugin-no-relative-import-paths";
import unusedImports from "eslint-plugin-unused-imports";
import importPlugin from "eslint-plugin-import";
import i18next from "eslint-plugin-i18next";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  i18next.configs["flat/recommended"],
  {
    plugins: {
      next: eslintNextPlugin,
    },
    settings: {
      next: {
        rootDir: "web-app/",
      },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
      "no-relative-import-paths": noRelativeImportPaths,
      "unused-imports": unusedImports,
      import: importPlugin,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "unused-imports/no-unused-imports": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "@next/next/no-html-link-for-pages": ["error", "src/app"],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Please use our custom getEnvSecrets or getEnvConfig functions instead of process.env as it is validated on startup and type-safe.",
        },
      ],
      "no-relative-import-paths/no-relative-import-paths": [
        "error",
        { allowSameFolder: true },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project specific ignores:
    "prisma/generated/**",
    "src/lib/clients/generated/**",
    "src/components/ui/**",
    "public/js/**/*.js",
    "*.config.mjs",
    "*.config.js",
    "jest.setup.js",
    "**/__tests__/**",
  ]),
]);

export default eslintConfig;
