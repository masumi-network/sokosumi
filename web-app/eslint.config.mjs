import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: {
    extends: ["eslint:recommended", "plugin:react/recommended"],
  },
});

const eslintConfig = [
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript", "prettier"],
    plugins: [
      "simple-import-sort",
      "import",
      "prettier",
      "unused-imports",
      "no-relative-import-paths",
    ],
    ignorePatterns: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "src/components/ui/**",
      "src/lib/api/generated/**",
      "public/js/**/*.js",
      "*.config.mjs",
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
