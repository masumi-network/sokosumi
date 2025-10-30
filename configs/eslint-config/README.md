# @sokosumi/eslint-config

Shared ESLint configuration for the Sokosumi monorepo.

## Usage

### For Library Packages

Use the default export which includes the `import` plugin:

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import soksumiConfig from "@sokosumi/eslint-config";

const eslintConfig = defineConfig([
  ...soksumiConfig,
  // Add package-specific rules here
  globalIgnores([
    // Add package-specific ignores
  ]),
]);

export default eslintConfig;
```

### For Apps with Next.js (or other frameworks that provide import plugin)

Use the base export without the `import` plugin to avoid conflicts:

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import soksumiConfig from "@sokosumi/eslint-config/base";
import nextConfig from "eslint-config-next";

const eslintConfig = defineConfig([
  ...nextConfig,
  ...soksumiConfig,
  // Add package-specific rules here
]);

export default eslintConfig;
```

## Included Rules

### Import Organization
- Automatically sorts imports
- Removes unused imports
- Enforces consistent import ordering

### TypeScript
- TypeScript recommended rules
- Allows unused variables prefixed with underscore

### Prettier Integration
- Disables conflicting ESLint formatting rules


