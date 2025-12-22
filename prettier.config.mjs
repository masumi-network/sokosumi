/**
 * Base Prettier configuration for the Sokosumi monorepo.
 * Extended by individual packages with their specific needs.
 *
 * @type {import('prettier').Config}
 */
const config = {
  trailingComma: "all",
  tabWidth: 2,
  semi: true,
  singleQuote: false,
  ignorePatterns: ["pnpm-lock.yaml"],
};

export default config;
