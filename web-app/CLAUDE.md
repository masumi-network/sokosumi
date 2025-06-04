# SOKOSUMI WEB APP GUIDELINES

## Commands

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production (includes Prisma generation)
- `pnpm run lint` - Run ESLint
- `pnpm run format` - Format code with Prettier
- `pnpm run test` - Run Jest tests in watch mode
- `pnpm run test -- -t "test name"` - Run specific test
- `pnpm run prisma:generate` - Generate Prisma client
- `pnpm run prisma:migrate` - Run Prisma migrations
- `pnpm run generate:api` - Generate API clients
- `pnpm run data-migration:*` - Run specific data migrations

## Code Style

- TypeScript for all code; strict typing with interfaces preferred over types
- Functional components; avoid classes
- Use named exports for components
- Follow directory naming: lowercase with dashes (e.g., `auth-wizard`)
- Prefix event handlers with "handle" (e.g., `handleSubmit`)
- Imports organized with simple-import-sort (auto-fixable with lint)
- Prefer server components; limit 'use client' directives
- Use descriptive variable names with auxiliary verbs (isLoading, hasError)
- Structure files: exports, subcomponents, helpers, types
- Error handling: use try/catch with descriptive error messages
- No JSX literals allowed (enforced by ESLint rule)
- Use nullish coalescing operator (??) over logical OR (||) when appropriate
- Unused variables prefixed with underscore (\_) are allowed
- No relative imports for cross-directory navigation (use absolute paths with @ aliases)

## Import Paths & Aliases

- `@/*` - Root src directory
- `@/app/*` - App router pages
- `@/landing/*` - Landing pages
- `@/auth/*` - Authentication pages
- `@/api/*` - API routes
- `@/components/*` - Reusable components
- `@/config/*` - Configuration files
- `@/context/*` - React contexts
- `@/hooks/*` - Custom hooks
- `@/lib/*` - Library code and utilities
- `@/services/*` - Service layer
- `@/types/*` - Type definitions
- `@/messages/*` - Internationalization messages
- `@/prisma/*` - Database schema and utilities

## Environment & Configuration

- Use custom `getEnvSecrets` or `getEnvConfig` functions instead of `process.env`
- All environment variables are validated on startup and type-safe
- Configuration files use ESM format (.mjs, .ts)

## UI & Styling

- Tailwind CSS for styling with custom configuration
- shadcn/ui components in `src/components/ui/`
- Double quotes for strings (enforced by Prettier)
- 2-space indentation
- Trailing commas everywhere

## Database

- Prisma ORM with PostgreSQL
- Migration files include data migrations when needed
- Seed data available via `pnpm run prisma:seed`

## Testing

- Jest with Testing Library
- Tests in `__tests__` directories or `.test.ts` files
- Run with `pnpm run test` (watch mode) or `pnpm run test:ci`

## Git Style

- Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commits and pull request titles
