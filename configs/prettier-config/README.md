# @sokosumi/prettier-config

Shared Prettier configuration for the Sokosumi monorepo.

## Usage

### Base Configuration (No plugins)

For non-web packages (e.g., database package):

```js
// prettier.config.mjs
import config from "@sokosumi/prettier-config";

export default config;
```

### With Tailwind CSS Plugin

For web applications using Tailwind CSS:

```js
// prettier.config.mjs
import config from "@sokosumi/prettier-config/tailwind";

export default config;
```

## Configuration

- **trailingComma**: `all`
- **tabWidth**: `2`
- **semi**: `true`
- **singleQuote**: `false`


