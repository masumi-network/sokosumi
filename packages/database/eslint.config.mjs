import { defineConfig, globalIgnores } from "eslint/config";
import baseConfig from "../../eslint.config.mjs";

const eslintConfig = defineConfig([
  ...baseConfig,
  globalIgnores([
    "src/generated/**",
    "dist/**",
    "*.config.mjs",
    "*.config.js",
    "*.config.ts",
  ]),
]);

export default eslintConfig;


