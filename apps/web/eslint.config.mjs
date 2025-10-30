import { defineConfig, globalIgnores } from "eslint/config";
import baseConfig from "../../eslint.config.mjs";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import eslintNextPlugin from "eslint-config-next";
import i18next from "eslint-plugin-i18next";
import noRelativeImportPaths from "eslint-plugin-no-relative-import-paths";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...baseConfig,
  i18next.configs["flat/recommended"],
  {
    plugins: {
      next: eslintNextPlugin,
      "no-relative-import-paths": noRelativeImportPaths,
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
    rules: {
      "@next/next/no-html-link-for-pages": ["error", "src/app"],
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Please use our custom getEnvSecrets or getEnvConfig functions instead of process.env as it is validated on startup and type-safe.",
        },
      ],
      // Enforce absolute imports for web app code (inherited from shared config)
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
