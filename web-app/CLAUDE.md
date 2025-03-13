# SOKOSUMI WEB APP GUIDELINES

## Commands
- `npm run dev` - Start development server
- `npm run build` - Build for production (includes Prisma generation)
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run test` - Run Jest tests in watch mode
- `npm run test -- -t "test name"` - Run specific test
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run Prisma migrations
- `npm run generate:api` - Generate API clients

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

## Git Style
- use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commits and pull request titles