# Sokosumi Web App Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the Sokosumi web application. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md).

## App-Specific Architecture

**Framework**: Next.js 16 App Router with React 19.2 Server Components
**Location**: `apps/web/` directory within the pnpm workspace
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
├── (flows)/            # Transitional/public flows (e.g. accept-invitation)
├── api/                 # API route handlers
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

### useEffect and client-side effects

Use Effects only to **synchronize with external systems** (browser APIs, third-party widgets). Avoid Effects for derived state, user events, or mirroring props/state—dependency arrays hide coupling and effect chains are hard to trace.

- **Do not use Effects for**: derived state (compute during render), filtering lists (derive or `useMemo`), resetting state on prop change (use `key` to remount), user events (use event handlers), data fetching (use a library like React Query/SWR), chains of state updates, notifying parent (use handler or lift state).
- **Smell tests**: State used as a flag so an effect can “do the real action” → use the event handler. Effect that only resets when an ID/prop changes → use `key` and remount.
- **Mount-only sync**: For “run once on mount, cleanup on unmount” (DOM focus, third-party widget, browser API), use a named hook such as `useMountEffect(effect)` (i.e. `useEffect(effect, [])`) so intent is explicit. Prefer conditional mounting: don’t mount the child until preconditions are met, then the child can use the mount-only hook.
- **Do use Effects for**: mount-only external sync (via `useMountEffect`), external store subscriptions (`useSyncExternalStore` when applicable), syncing with non-React systems. For fetching that must stay in sync with props and a library isn’t feasible, use Effects only with proper cleanup to avoid race conditions.

See [.cursor/rules/effects.mdc](.cursor/rules/effects.mdc) for examples and references (react.dev, Factory “Why we banned useEffect”).

### Linting & Formatting

The web app uses the shared Biome configuration from the repo root. See [root AGENTS.md](../../AGENTS.md#linting--formatting) for base rules.

- `pnpm web:check` runs `biome check`, so it enforces linting, formatting, and import organization
- `pnpm web:check:write` applies Biome fixes, including import organization
- `pnpm web:lint` runs `biome lint`, so it checks lint rules only
- Some older ESLint-only rules were intentionally removed during the Biome migration and are now conventions rather than enforced diagnostics

#### Environment Variables

**Critical**: Never use `process.env` directly in web app code.

- **Status**: This is a repository convention and code review rule; it is no longer enforced by the formatter/linter.
- **Fix**: Use typed config functions:
  - `getEnvSecrets()` - for sensitive variables (API keys, database URLs)
  - `getEnvConfig()` - for public configuration (feature flags, URLs)

**Example**:

```typescript
// ❌ Wrong
const apiKey = process.env.API_KEY;

// ✅ Correct - type-safe and validated
import { getEnvSecrets } from "@/config/env.secrets";
const apiKey = getEnvSecrets().API_KEY;
```

#### Import Paths

- **No relative imports** across directories
- Same-folder relative imports are allowed: `import { helper } from "./helper"`
- Use `@/` alias for all cross-directory imports
- For App Router modules, always import via `@/app/<subpath>` and never `src/app/(app)` in import paths

**Examples**:

```typescript
// ✅ Correct
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/services/user";
import { JobsList } from "@/app/agents/[agentId]/jobs/components/jobs-list";
import { helper } from "./helper"; // same folder

// ❌ Wrong
import { Button } from "../../components/ui/button";
import { getUser } from "../services/user";
import { JobsList } from "src/app/(app)/agents/[agentId]/jobs/components/jobs-list";
```

**Fix**: Convert cross-directory imports to absolute paths with `@/`

#### Next.js Specific

- Use Next.js `<Link>` component for internal navigation
- Never use `<a>` tags for page navigation
- Optimize images with `<Image>` component

- **Status**: This remains the expected project convention, but it is not currently enforced by Biome

#### Internationalization (i18next)

- All user-facing text requires translation keys
- Use `useTranslations()` hook in components
- Add new keys to `messages/en.json`

- **Status**: This remains the expected project convention, but it is not currently enforced by Biome

## App-Specific Commands

| Command           | Purpose                   |
| ----------------- | ------------------------- |
| `pnpm web:dev`    | Start development server  |
| `pnpm web:build`  | Build for production      |
| `pnpm web:start`  | Test production build     |
| `pnpm web:lint`   | Run Biome lint rules for the web app |
| `pnpm web:check`  | Run full Biome checks for the web app |
| `pnpm web:test`   | Run web app tests         |
| `pnpm web:format` | Format code with Biome |

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
- **Locale-safe formatting in client components**: never use bare `.toLocaleString()` or default-locale `Intl.*` for numbers/dates in `'use client'` code — Node and the browser can format differently and cause hydration errors. Use `useFormatter().number()` / `useFormatter().dateTime()` in client components and `getFormatter()` in server components. See [.cursor/rules/i18n-formatting.mdc](.cursor/rules/i18n-formatting.mdc).
- `messages/en.json` is the source-of-truth catalog for the web app
- Every supported locale file in `messages/*.json` must keep the exact same key paths as `messages/en.json`
- When a key is added, removed, renamed, or moved in `messages/en.json`, apply the same path change to every supported locale file in the same change
- If a translated value is not available yet, temporarily copy the English string so the key exists in every locale file

### Database Access

- Use repository pattern from `@sokosumi/database/repositories`
- Create Prisma client instance at `@/lib/db/prisma`
- Never access Prisma directly from components
- Use server actions for mutations

### Core API reads & caching (performance)

We are migrating web data access from direct DB reads to the Core API
(`coreClient` in `src/lib/clients/core.client.ts`). Two performance rules:

- **Never blindly cache Core responses across requests.** Every `coreClient`
  call attaches the caller's cookies (`buildAuthHeaders`) and defaults to
  `cache: "no-store"`, because most responses are **user/workspace-scoped** —
  caching them in Next's shared fetch cache would leak one user's data to
  another. Keep `no-store` for anything user-specific.
- **Do cross-request cache _global_ catalog reads.** The agent catalog
  (`GET /v1/agents`) is global — it carries no per-user fields and is not
  user-scoped — so it is safe to share. `getAllCoreAgents`
  (`src/lib/agents/core-loaders.ts`) loads every page of the catalog; without
  caching, **every page that needs agents re-paginates the whole catalog over
  HTTP on every request** (React `cache()` only dedupes within one request).
  It opts into fetch-level revalidation via `coreClient.getAgents(query,
  { revalidate, tags: [AGENTS_CACHE_TAG] })`, so the catalog is fetched at most
  once per TTL across all users. Invalidate on demand with
  `revalidateTag(AGENTS_CACHE_TAG)`. The proper long-term fix is a Core
  endpoint that returns the filtered catalog in one call (see the
  `TODO(core-api)` in `core-loaders.ts`); until then, do not add new
  per-request all-pages loops.

### Better Auth ID generation

- Better Auth runs on **Core**, not web. `apps/core/src/lib/auth.ts` sets `advanced.database.generateId: "uuid"` so Better Auth–managed rows get UUID-shaped primary keys, consistent with `@sokosumi/database` Prisma models. Web reaches auth via `auth.client.ts` / `auth.server.ts` → Core `/auth` only. Do not remove or change UUID generation without aligning the shared schema and any database migrations.

### Stripe: Sandbox (test) vs production

Stripe **test mode** and **live mode** are separate environments. The app does not switch modes in code; it uses whatever `STRIPE_*` env vars are set.

| Aspect             | Sandbox (test)                                                  | Production (live)                                                              |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **API keys**       | `sk_test_...`, `pk_test_...`                                    | `sk_live_...`, `pk_live_...`                                                   |
| **Data**           | Coupons, products, prices, customers in **test** dashboard only | Same resources must exist in **live** dashboard; they are not copied from test |
| **Webhook secret** | From Stripe test webhook endpoint                               | From Stripe live webhook endpoint                                              |

**If coupons work in sandbox but not in production:**

1. **Coupon/product IDs** – Create the same coupons (and credit product/prices) in the **live** Stripe Dashboard, or set production env vars to the live coupon/product IDs. Test data does not exist in live.
2. **Stripe customer** – Users have a `stripeCustomerId` in your DB; in production that ID must refer to a customer in the **live** Stripe account. New production users get a customer created in live when they first use Stripe.
3. **Auth in server actions** – When claiming a coupon from a server action, the credits flow passes the request auth into `stripeService.claimCoupon` so it does not rely on `getAuthContext()` again (which can be null in production if cookies/headers differ).

Env vars that must be set per environment: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREDIT_PRODUCT_ID` (and optionally `STRIPE_PUBLISHABLE_KEY` for client-side). The welcome coupon (`STRIPE_WELCOME_COUPON`) is configured on the core app, which owns the `customer.created` webhook.

**Enterprise subscription products:** Enterprise products are discovered from Stripe product metadata, not env vars. Configure each active enterprise product with `metadata.slug=enterprise`, `metadata.credits=<positive integer>`, and a monthly recurring `default_price`.

**Coupon semantics for credits:** Credits come from the coupon metadata key `credits` (positive integer). The discount at checkout is applied via the coupon’s `percent_off`. Only coupons with both `metadata.credits` and `percent_off` are supported; `amount_off`-only coupons are not supported.

### Styling

- Use semantic colors from `globals.css`
- Ensure dark/light mode compatibility
- Use `size-*` utilities instead of `h-* w-*`

## Development Workflow

1. **Start Development**: `pnpm web:dev`
2. **Database Changes**: Run migrations with `pnpm prisma:migrate:dev`
3. **Testing**: Run `pnpm web:test` before committing
4. **Formatting**: Run `pnpm format` after changes

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

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

### Logging in (auth-gated pages)

The sign-in form is a controlled `react-hook-form`. Programmatic value-setting
(the auth-vault `fill`→`click` path) can race React's state flush, so the
vault's submit **click** often no-ops while the field values look correct. The
form itself is fine — submitting via **Enter** works because state has flushed
by then.

Each coworker stores their **own** credentials (nothing shared/committed):

```bash
# one-time, per machine — password read from stdin, never echoed
agent-browser auth save sokosumi \
  --url http://localhost:3000/signin \
  --username you@nmkr.io --password-stdin
```

Reliable login recipe (fill via vault, submit via Enter — not the vault click):

```bash
agent-browser open http://localhost:3000/signin
agent-browser auth login sokosumi      # fills email + password
agent-browser press Enter              # submits the form
agent-browser wait --load networkidle
```

Stable selectors exist for deterministic targeting if you fill fields yourself:
`[data-testid="auth-field-email"]`, `[data-testid="auth-field-currentPassword"]`,
`[data-testid="auth-submit"]`.

Prefer session reuse so you only log in once per machine:

```bash
export AGENT_BROWSER_SESSION_NAME=sokosumi   # auto-saves/restores cookies
```

## Additional Rules

- [Avoid re-exports](../../.cursor/rules/avoid-re-exports.mdc) – import shared symbols from `@sokosumi/utils` / `@sokosumi/database` directly; no passthrough files
- [Utils vs database helpers](../../.cursor/rules/utils-vs-database.mdc) – import `@sokosumi/utils` from client components; never `@sokosumi/database/helpers`
- [Analysis Process](.cursor/rules/analysis-process.mdc)
- [Effects](.cursor/rules/effects.mdc)
- [Interface](.cursor/rules/interface.mdc)
- [Key Conventions](.cursor/rules/key-convention.mdc)
- [Key Principles](.cursor/rules/key-principles.mdc)
- [Linting](.cursor/rules/lint.mdc)
- [Naming Convention](.cursor/rules/naming-convention.mdc)
- [Optimization](.cursor/rules/optimization.mdc)
- [Translations](.cursor/rules/translations.mdc)
- [Locale-safe formatting](.cursor/rules/i18n-formatting.mdc) – `useFormatter` / `getFormatter`; avoid bare `toLocaleString()` in client components
- [TypeScript](.cursor/rules/typescript.mdc)

## References

- [Root AGENTS.md](../../AGENTS.md) - Comprehensive monorepo guidelines
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next-intl Documentation](https://next-intl-docs.vercel.app/)
- [Shadcn UI Components](https://ui.shadcn.com/)

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root: ./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: cd apps/web && npx @next/codemod agents-md --output AGENTS.md|01-app:{04-glossary.mdx}|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-fetching-data.mdx,07-mutating-data.mdx,08-caching.mdx,09-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{ai-agents.mdx,analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching-without-cache-components.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instant-navigation.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,migrating-to-cache-components.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,preserving-ui-state.mdx,production-checklist.mdx,progressive-web-apps.mdx,public-static-pages.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,streaming.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions/02-route-segment-config:{dynamicParams.mdx,instant.mdx,maxDuration.mdx,preferredRegion.mdx,runtime.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,catchError.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,deploymentId.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,turbopackIgnoreIssue.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-params.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,deploymentId.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,logging.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->
