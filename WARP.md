# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Commands

### Monorepo Commands (run from root)
- `pnpm install` - Install all dependencies across workspace
- `pnpm dev` - Start development server for all packages
- `pnpm build` - Build all packages for production
- `pnpm lint` - Run ESLint across all packages with zero warning tolerance
- `pnpm test` - Run test suites for all packages
- `pnpm test:ci` - Run tests in CI mode across all packages

### Web App Specific Commands (run from `web-app/` or prefix with `sokosumi-web:`)
- `pnpm dev` - Start Next.js dev server on http://localhost:3000
- `pnpm build` - Build for production (includes Prisma generation)
- `pnpm start` - Serve production build
- `pnpm format` - Format code with Prettier
- `pnpm test:ci` - Run Jest tests in CI mode

### Database Commands (Prisma)
- `pnpm prisma:generate` - Generate Prisma client
- `pnpm prisma:migrate:dev` - Run migrations in development
- `pnpm prisma:migrate:deploy` - Deploy migrations in production
- `pnpm prisma:migrate:reset` - Reset database and migrations
- `pnpm prisma:seed` - Seed database with initial data
- `pnpm prisma:studio` - Open Prisma Studio for database inspection

### API Client Generation
- `pnpm generate:api` - Generate API clients for external services (Registry & Payment)
- `pnpm generate:registry` - Generate Registry service client only
- `pnpm generate:payment` - Generate Payment service client only

### Data Migrations
- `pnpm data-migration:<migration-name>` - Run specific data migration script
- Examples: `pnpm data-migration:job-sync`, `pnpm data-migration:add-organization`

### Testing Individual Components
- `pnpm test:ci` - No watch mode configured; use CI mode for all testing
- Tests are located in `__tests__` directories alongside feature code

## High-Level Architecture

### Monorepo Structure
Sokosumi is a pnpm workspace with the main development happening in `web-app/`. The monorepo integrates with external Masumi services (Registry and Payment) through auto-generated API clients.

### Core Application Architecture

#### Next.js 15 App Router
- **Framework**: Next.js 15 with App Router pattern
- **TypeScript**: Strict typing throughout, prefer interfaces over types
- **Authentication**: Better Auth with organization support and email verification
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Internationalization**: next-intl for multi-language support

#### Three-Layer Service Architecture

**1. Repository Layer (`src/lib/db/repositories/`)**
- Database access layer using Prisma ORM with PostgreSQL
- Type-safe database operations with transaction support
- Each repository follows consistent interface pattern
- Examples: `userRepository`, `organizationRepository`, `jobRepository`

**2. Service Layer (`src/lib/services/`)**
- Business logic organized by domain (agent, job, organization, user, etc.)
- Handles external API calls and complex operations
- Each service exports main service object and types
- Integrates with auto-generated API clients for external services

**3. Action Layer (`src/lib/actions/`)**
- Server Actions for form handling and mutations
- Structured error handling with typed error codes
- Organized by domain with consistent exports pattern
- Examples: `auth/`, `job/`, `organization/`, `billing/`

#### Key Architectural Patterns

**Database Schema Design**
- Users with profile information and organization membership
- Organizations with member management and billing
- Jobs (AI agent tasks) with input/output tracking and credit billing
- Credit system for usage-based billing
- Agent listings with ratings and bookmarks

**External Service Integration**
- **Masumi Registry**: Agent discovery and metadata (auto-generated client)
- **Masumi Payment**: Billing and transaction processing (auto-generated client)
- **Stripe**: Payment processing and subscription management
- **Resend**: Transactional email delivery via @react-email/components

**Authentication & Authorization**
- Session-based authentication with configurable expiration
- Organization-based access control with member roles
- Email verification and password reset flows
- Support for multiple organizations per user

#### Development Patterns & Conventions

**Code Style**
- TypeScript mandatory; avoid enums, use maps/unions instead
- Functional components with named exports
- Server Components by default; `'use client'` only when needed for Web APIs
- Event handlers prefixed with "handle" (e.g., `handleSubmit`)
- Directory naming: kebab-case (e.g., `auth-wizard`)
- No relative imports for cross-directory navigation; use absolute paths with `@/` aliases

**Import Aliases**
- `@/app/*` - App router pages
- `@/components/*` - Reusable components (UI components in `@/components/ui/`)
- `@/lib/*` - Library code and utilities
- `@/services/*` - Service layer
- `@/actions/*` - Server Actions
- `@/types/*` - Type definitions
- `@/prisma/*` - Database schema and utilities

**State Management**
- Use `nuqs` for URL search parameter state management
- Prefer server state and Server Components
- Client state only when necessary for user interactions

**Error Handling**
- Structured error handling with custom error types
- Result pattern implementation
- Try/catch with descriptive error messages

**Environment & Configuration**
- Type-safe environment variable validation via `getEnvSecrets`/`getEnvConfig`
- Never use `process.env` directly
- All environment variables validated on startup

#### Testing Strategy
- Jest with Testing Library for component and integration tests
- Tests located in `__tests__` directories alongside feature code
- Mock external services with existing fixtures
- No watch mode configured; use `pnpm test:ci` for all testing

#### Data Migrations
- Prisma migrations include data migration scripts when needed
- Each migration may have an associated TypeScript data migration script
- Run specific data migrations via `pnpm data-migration:<name>` commands

## Development Setup

1. **Prerequisites**: Node.js v22+ and pnpm package manager
2. **Install**: Run `pnpm install` from monorepo root
3. **Environment**: Copy `web-app/.env.example` to `web-app/.env` and configure
4. **Database**: Run `pnpm prisma:migrate:dev` to set up database
5. **Development**: Run `pnpm dev` to start development server
6. **API Clients**: Run `pnpm generate:api` if OpenAPI specs have changed

## Production URLs
- **Production**: https://app.sokosumi.com
- **Staging**: https://preprod.sokosumi.com

## Commit Guidelines
- Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- Apply to both commit messages and PR titles
- Examples: `feat(auth): add passkey login`, `fix(billing): resolve credit calculation`

<citations>
  <document>
      <document_type>WARP_DOCUMENTATION</document_type>
      <document_id>getting-started/quickstart-guide/coding-in-warp</document_id>
  </document>
</citations>