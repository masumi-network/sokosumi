import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: {
    extends: ["eslint:recommended", "plugin:react/recommended"],
  },
});

const eslintConfig = [
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript", "prettier"],
    plugins: ["simple-import-sort", "import", "prettier", "unused-imports"],
    ignorePatterns: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "src/components/ui/**",
      "src/lib/api/generated/**",
    ],
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "prettier/prettier": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "unused-imports/no-unused-imports": "error",
    },
    parserOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
  }),
];

export default eslintConfig;
