# Sokosumi Web App Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi web application. For comprehensive monorepo guidelines, see [`../AGENTS.md`](../AGENTS.md).

## App-Specific Architecture

**Framework**: Next.js 16 App Router with React 19.2 Server Components
**Location**: `web-app/` directory within the pnpm workspace
**Key Directories**:

- `src/app/` - App Router routes, server actions, API handlers
- `src/components/` - Shared UI components (Shadcn UI + Radix)
- `src/lib/` - Domain logic following three-layer pattern
- `src/hooks/` - Custom React hooks
- `src/contexts/` - React contexts

## App Router Structure

```
src/app/
├── (app)/              # Protected app routes
├── (auth)/             # Authentication routes
├── api/                 # API route handlers
├── onboarding/          # User onboarding flow
├── share/               # Public sharing routes
├── layout.tsx           # Root layout
├── globals.css          # Global styles with semantic colors
└── not-found.tsx        # 404 page
```

## App-Specific Conventions

### Server Components First

- Default to Server Components for all new components
- Use `'use client'` only when accessing browser APIs
- Leverage server actions for mutations instead of client-side state

### Route Organization

- Group related routes using parentheses: `(app)`, `(auth)`
- Use parallel routes for complex layouts
- Implement proper loading and error boundaries

### Component Patterns

- Use Shadcn UI components from `src/components/ui/`
- Implement responsive design with Tailwind CSS
- Follow the established component structure pattern

## App-Specific Commands

| Command                   | Purpose                  |
| ------------------------- | ------------------------ |
| `pnpm sokosumi-web:dev`   | Start development server |
| `pnpm sokosumi-web:build` | Build for production     |
| `pnpm sokosumi-web:start` | Test production build    |
| `pnpm sokosumi-web:lint`  | Lint web app             |
| `pnpm sokosumi-web:test`  | Run web app tests        |

## App-Specific Testing

- Test files colocated in `__tests__/` directories
- Mock external APIs using `__mocks__/` directory
- Test both server and client components appropriately
- Use Testing Library for component testing

## App-Specific Gotchas

### Authentication

- Routes under `(auth)/` are public
- Routes under `(app)/` require authentication
- Use `useWithAuthentication` hook for client-side auth checks

### Internationalization

- All user-facing text must use `next-intl`
- Translation keys in `messages/en.json`
- Use `useTranslations` hook in components

### Database Access

- Use repository pattern from `src/lib/db/repositories/`
- Never access Prisma directly from components
- Use server actions for mutations

### Styling

- Use semantic colors from `globals.css`
- Ensure dark/light mode compatibility
- Use `size-*` utilities instead of `h-* w-*`

## Development Workflow

1. **Start Development**: `pnpm sokosumi-web:dev`
2. **Database Changes**: Run migrations with `pnpm prisma:migrate:dev`
3. **API Changes**: Regenerate clients with `pnpm generate:api`
4. **Testing**: Run `pnpm test` before committing
5. **Formatting**: Run `pnpm sokosumi-web:format` after changes

## Common Patterns

### Creating a New Page

```typescript
// src/app/(app)/new-page/page.tsx
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'New Page',
};

export default function NewPage() {
  return (
    <div className="container mx-auto p-4">
      {/* Server Component content */}
    </div>
  );
}
```

### Creating a Server Action

```typescript
// src/lib/actions/new-action.ts
"use server";

import { revalidatePath } from "next/cache";

export async function createNewItem(data: FormData) {
  // Server action logic
  revalidatePath("/path");
}
```

### Using Translations

```typescript
// In a component
import { useTranslations } from 'next-intl';

export function MyComponent() {
  const t = useTranslations('common');
  return <h1>{t('title')}</h1>;
}
```

## References

- [Root AGENTS.md](../AGENTS.md) - Comprehensive monorepo guidelines
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next-intl Documentation](https://next-intl-docs.vercel.app/)
- [Shadcn UI Components](https://ui.shadcn.com/)
