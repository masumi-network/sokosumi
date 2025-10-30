# @sokosumi/eslint-config

Shared ESLint configuration for the Sokosumi monorepo.

## Usage

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


