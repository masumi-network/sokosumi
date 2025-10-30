import { defineConfig, globalIgnores } from "eslint/config";
import soksumiConfig from "@sokosumi/eslint-config";

const eslintConfig = defineConfig([
  ...soksumiConfig,
  globalIgnores([
    "src/generated/**",
    "dist/**",
    "*.config.mjs",
    "*.config.js",
    "*.config.ts",
  ]),
]);

export default eslintConfig;


