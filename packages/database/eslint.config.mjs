import { defineConfig, globalIgnores } from "eslint/config";
import soksumiConfig from "@sokosumi/eslint-config";
import importPlugin from "eslint-plugin-import";

const eslintConfig = defineConfig([
  ...soksumiConfig,
  {
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
    },
  },
  globalIgnores([
    "src/generated/**",
    "dist/**",
    "*.config.mjs",
    "*.config.js",
    "*.config.ts",
  ]),
]);

export default eslintConfig;


