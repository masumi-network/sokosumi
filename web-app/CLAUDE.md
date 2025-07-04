# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# SOKOSUMI WEB APP GUIDELINES

## Commands

- `pnpm run dev` - Start development server
- `pnpm run build` - Build for production (includes Prisma generation)
- `pnpm run lint` - Run ESLint
- `pnpm run format` - Format code with Prettier
- `pnpm run test` - Run Jest tests in watch mode
- `pnpm run test:ci` - Run Jest tests in CI mode
- `pnpm run test -- -t "test name"` - Run specific test
- `pnpm run prisma:generate` - Generate Prisma client
- `pnpm run prisma:migrate:dev` - Run Prisma migrations in development
- `pnpm run prisma:migrate:deploy` - Deploy Prisma migrations in production
- `pnpm run prisma:migrate:reset` - Reset Prisma migrations
- `pnpm run prisma:seed` - Seed the database
- `pnpm run prisma:studio` - Open Prisma Studio
- `pnpm run generate:api` - Generate API clients (registry and payment services)
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

## Architecture Overview

This is a Next.js 15 web application using the App Router with a service-oriented architecture:

### Core Technologies
- **Next.js 15**: React framework with App Router
- **TypeScript**: Strict type checking enabled
- **Prisma**: Database ORM with PostgreSQL
- **Better Auth**: Authentication with organization support
- **Tailwind CSS**: Utility-first styling
- **shadcn/ui**: Component library
- **Resend**: Email service for transactional emails

### Key Architecture Patterns

#### Service Layer (`src/lib/services/`)
- Business logic organized by domain (agent, job, organization, etc.)
- Services handle external API calls and complex operations
- Each service exports a main service object and types

#### Action Layer (`src/lib/actions/`)
- Server Actions for form handling and mutations
- Structured error handling with typed error codes
- Each action domain exports both actions and error types

#### Repository Pattern (`src/lib/db/repositories/`)
- Database access layer with Prisma
- Type-safe database operations
- Centralized database queries and mutations

#### API Integration (`src/lib/api/generated/`)
- Auto-generated clients for external services (Payment & Registry)
- Generated from OpenAPI specifications
- Type-safe API calls with proper error handling

### Authentication & Authorization
- Better Auth with email/password and organization plugins
- Session-based authentication with configurable expiration
- Organization-based access control with member roles
- Email verification and password reset flows

### Database Schema
- Users with profile information and preferences
- Organizations with member management
- Jobs (AI agent tasks) with input/output tracking
- Credit system for billing and usage tracking
- Agent listings with ratings and bookmarks

### External Services
- **Masumi Registry**: Agent discovery and metadata
- **Masumi Payment**: Billing and transaction processing
- **Stripe**: Payment processing and subscription management
- **Resend**: Transactional email delivery

### Development Patterns
- Server Components by default, Client Components when needed
- Structured error handling with custom error types
- Type-safe environment variable validation
- Comprehensive form validation with Zod schemas
- Internationalization support with next-intl
