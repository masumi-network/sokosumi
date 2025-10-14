import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "prisma/generated/**",
      "src/components/ui/**",
      "src/lib/clients/generated/**",
      "public/js/**/*.js",
      "*.config.mjs",
      "*.config.js",
      "jest.setup.js",
      "**/__tests__/**",
    ],
  },
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript", "prettier"],
    plugins: [
      "simple-import-sort",
      "import",
      "prettier",
      "unused-imports",
      "no-relative-import-paths",
    ],
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "prettier/prettier": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "react/jsx-no-literals": "error",
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
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
    parserOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      project: "./tsconfig.json",
      tsconfigRootDir: import.meta.dirname,
    },
  }),
];

export default eslintConfig;
