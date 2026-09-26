# Code conventions and testing

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

### TypeScript Usage

- **Mandatory**: Use TypeScript for all code
- **Interfaces**: Prefer interfaces over types. One exception: a shape written
  verbatim into a Prisma `Json` column must be an object type alias — see
  [Prisma JSON columns](../../.cursor/rules/prisma-json-columns.mdc)
- **Enums**: Avoid enums; use maps instead
- **Components**: Use functional components with TypeScript interfaces
- **Inference**: Leverage Prisma type inference when possible
- **Type assertions**: Avoid `as unknown as X` double casts and `as any`; they discard type safety and hide bugs. Prefer typed APIs, type guards, or schema validation. Reach for a single `as` only to narrow a known-safe type (e.g. auth context).

### Naming & Patterns

- **Components**: PascalCase (e.g., `UserProfile`)
- **Types/Interfaces**: PascalCase (e.g., `UserData`)
- **Functions**: camelCase (e.g., `getUserData`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `API_BASE_URL`)
- **Directories**: kebab-case (e.g., `user-profile`)
- **Prisma Models**: Singular (e.g., `User`, not `Users`)
- **Event Handlers**: Prefix with `handle` (e.g., `handleSubmit`)
- **Exports**: Prefer named exports
- **Functions**: Use `function` keyword for pure functions

### Code Style

- **Indentation**: Two spaces, semicolons enforced by Biome
- **Formatting**: Run `pnpm format` after substantial edits
- **Imports**: Relative within features, use aliases (`@/lib/*`) otherwise
- **Components**: Default to Server Components; add `'use client'` only for browser APIs

### Linting & Formatting

#### Biome Configuration

The monorepo uses a shared Biome configuration at the repo root (`biome.jsonc`). Each app and package that Biome should cover also has a `biome.json` with `"extends": "//"` so nested projects inherit that root config (see [Biome: big projects / monorepos](https://biomejs.dev/guides/big-projects/)). `apps/apple` is excluded there (`!apps/apple/**`); do not add a nested Biome config for Swift.

`@biomejs/biome` is a **root-only** `devDependency`. Root-level and workspace scripts all invoke `biome …` the same way; `pnpm run` puts `node_modules/.bin` on `PATH`, so the hoisted `@biomejs/biome` binary is used for full-repo commands (`pnpm check`, `pnpm lint`, `pnpm format`, …) and for per-package scripts without duplicating the dependency in each workspace package.

**Import Organization**:

- `pnpm check` runs a repo-wide `biome check`, which enforces linting, formatting, and import organization
- `pnpm lint` runs a repo-wide `biome lint`, which checks lint rules only
- Unused imports are reported and can be auto-fixed by Biome

**TypeScript Rules**:

- Unused variables/arguments should be prefixed with `_` when intentionally unused
- Applies to variables, function arguments, caught errors, and destructured arrays

**Example of valid unused variable patterns**:

```typescript
function handler(_req, res) {
  // unused req parameter
  const [first, _second] = array; // unused destructured value
  try {
    doSomething();
  } catch (_error) {
    // unused error
    return fallback;
  }
}
```

## Testing Guidelines

- **Framework**: Vitest with Testing Library and workspace-specific environments (for example `happy-dom` in `apps/web` and Node in packages and `apps/core`)
- **Test Files**: Name as `*.test.ts(x)` and place next to the source they cover (`foo.test.ts` beside `foo.ts`). Use `__tests__/` only for tests that do not map 1:1 to a single source file (cross-module contracts, harnesses, fixtures).
- **Coverage**: Cover both success and failure paths when touching `src/lib`
- **Mocking**: Colocate `vi.mock` (and Prisma factories in Core / `@sokosumi/database`) next to the test. Web has no `__mocks__/` directory.
- **Execution**: Run `pnpm test` from the repo root, or the relevant workspace command such as `pnpm --filter web test`, before pushing
- **Targeted reruns**: Use `pnpm --filter <workspace> test path/to/file.test.ts`. Do not insert an extra `--` before the file path for Vitest reruns.

### Code References

- Use backticks for file, directory, function, and class names
- Use `@/lib/*` aliases for imports

## Additional Rules

- [Color tokens](../../.cursor/rules/color-tokens.mdc) – semantic tokens only; no raw palette, hex literals, or opacity modifiers
- [Whole pixels](../../.cursor/rules/whole-pixels.mdc) – no fractional `px` on a layout or border length
- [Pinned dependencies](../../.cursor/rules/pinned-dependencies.mdc) – exact versions in `package.json`, no semver ranges on registry packages
- [Result Type with neverthrow](../../.cursor/rules/neverthrow.mdc)
- [Shared packages and deduplication](../../.cursor/rules/shared-packages.mdc) – when moving logic to `packages/utils` or refactoring duplicated code
- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – import from the canonical owner; no passthrough barrels between packages or apps
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – client-safe shared code in `@sokosumi/utils`; Prisma-backed logic in `@sokosumi/database`
- [Prisma JSON columns](../../.cursor/rules/prisma-json-columns.mdc) – `Prisma.InputJsonObject` / `InputJsonValue` at the producing helper, not a cast at the call site
