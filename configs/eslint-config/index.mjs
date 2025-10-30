import { defineConfig } from "eslint/config";
import baseConfig from "./base.mjs";
import importPlugin from "eslint-plugin-import";

/**
 * Full ESLint config with import plugin.
 * Extends the base config and adds import plugin rules.
 * Use this for library packages and applications that don't already provide the import plugin.
 */
const eslintConfig = defineConfig([
  ...baseConfig,
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
]);

export default eslintConfig;
