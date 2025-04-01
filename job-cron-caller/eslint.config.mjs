import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: {
    extends: ["eslint:recommended"],
  },
});

const eslintConfig = [
  ...compat.config({
    extends: ["plugin:@typescript-eslint/recommended", "prettier"],
    plugins: [
      "simple-import-sort",
      "import",
      "prettier",
      "unused-imports",
      "no-relative-import-paths",
      "@typescript-eslint"
    ],
    ignorePatterns: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "packages/*"
    ],
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "prettier/prettier": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
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
