# Performance Profile — Vercel Next.js Skill Audit

**Last updated:** 2026-02-03

This profile applies the **performance-focused** rules from the [Vercel React Best Practices](.cursor/skills/vercel-react-best-practices/AGENTS.md) skill only: §1 Eliminating Waterfalls, §2 Bundle Size Optimization, §3 Server-Side Performance, §4 Client-Side Data Fetching, §5 Re-render Optimization, §6 Rendering Performance, and §7 JavaScript Performance. Non-performance rules (e.g. auth or API design) are out of scope for now.

---

## 1. Eliminating Waterfalls (CRITICAL)

### 1.1 App layout — sequential awaits

**File:** `src/app/(app)/layout.tsx`

**Issue:** Five async operations run one after another on every app navigation:

```ts
const cookieStore = await cookies();
const session = await getSessionOrRedirect();
const isTaskManagerMenuEnabled = await taskManagerMenuEnabled();
const pendingInvitationId = await userService.getFirstPendingInvitationId();
const shouldShowOnboarding = await userService.showOnboarding(session);
```

**Impact:** Each `await` adds full round-trip latency. This layout runs on every (app) page load, so it directly affects LCP and perceived sluggishness.

**Skill ref:** §1.3 Prevent Waterfall Chains, §1.4 Promise.all() for Independent Operations.

**Recommendation:**

- Start independent work immediately; await only when needed.
- After `session` is available, run in parallel:
  - `taskManagerMenuEnabled()`
  - `userService.getFirstPendingInvitationId()`
  - `userService.showOnboarding(session)`
- Optionally start `cookies()` and `getSessionOrRedirect()` in parallel (session uses `headers()`, not `cookies()` for auth).

**Example:**

```ts
const cookieStorePromise = cookies();
const session = await getSessionOrRedirect();

const [
  cookieStore,
  isTaskManagerMenuEnabled,
  pendingInvitationId,
  shouldShowOnboarding,
] = await Promise.all([
  cookieStorePromise,
  taskManagerMenuEnabled(),
  userService.getFirstPendingInvitationId(),
  userService.showOnboarding(session),
]);
const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
```

---

### 1.2 Root layout — locale and messages

**File:** `src/app/layout.tsx`

**Issue:** `getLocale()` and `getMessages()` are awaited sequentially.

**Recommendation:** Run in parallel: `const [locale, messages] = await Promise.all([getLocale(), getMessages()]);`

---

### 1.3 Task detail page — session and translations after data

**File:** `src/app/(app)/tasks/[taskId]/page.tsx`

**Issue:** After `Promise.all([taskResult, orchestrators, agents])`, the page awaits `getSession()` and then `getTranslations()` sequentially.

**Recommendation:** Start `getSession()` and `getTranslations("App.Tasks.Detail")` early (e.g. in parallel with the first `Promise.all`), or at least run them in parallel with each other after the first batch so session and `t` are ready without extra waterfall.

---

### 1.4 MCP page — session and translations

**File:** `src/app/(app)/mcp/page.tsx`

**Issue:** `const session = await getSession();` then `const t = await getTranslations(...);` are sequential.

**Recommendation:** `const [session, t] = await Promise.all([getSession(), getTranslations("App.MCP")]);`

---

## 2. Server-Side Performance (HIGH)

### 2.1 No per-request deduplication (React.cache)

**Issue:** `getSession()` is used in many places (layout, taskManagerMenuEnabled, pages). It is not wrapped in `React.cache()`, so multiple calls in the same request can each hit the auth layer.

**Skill ref:** §3.4 Per-Request Deduplication with React.cache().

**Recommendation:** Wrap the session fetcher in `React.cache()` so that within a single request, all callers share one result, e.g.:

```ts
import { cache } from "react";

export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
});
```

Ensure `getSessionOrRedirect` and any flag that calls `getSession()` use this cached version.

---

### 2.2 Task manager flag calls getSession again

**File:** `src/lib/flags/task-manager.ts`

**Issue:** `taskManagerMenuEnabled`’s `decide` calls `getSession()`. The app layout already calls `getSessionOrRedirect()` (which uses `getSession()`). Without caching, the same request can trigger two session lookups.

**Recommendation:** After introducing cached `getSession()`, both the layout and the flag will share one session per request.

---

## 3. Bundle Size & Loading (CRITICAL / MEDIUM)

### 3.1 lucide-react

**Status:** Already optimized. `next.config.ts` has `optimizePackageImports: ["lucide-react"]`, so barrel imports are transformed at build time. No change needed.

---

### 3.2 Heavy / third-party components

**Observation:** Ably loads via mount-gated `import()` in `contexts/lazy-ably-provider.tsx` (Instant-safe; no `next/dynamic` + `ssr: false`). Root `ClientAnalytics` uses the same pattern for Vercel Analytics / SpeedInsights.

**Skill ref:** §2.3 Defer Non-Critical Third-Party Libraries, §2.4 Dynamic Imports for Heavy Components.

**Recommendation:** Prefer mount-gated client `import()` (or equivalent) over `next/dynamic` with `{ ssr: false }` on Instant-validated shells, which throws `BAILOUT_TO_CLIENT_SIDE_RENDERING` during Instant validation.

---

## 4. Strategic Suspense (HIGH)

### 4.1 App layout blocks entire shell

**File:** `src/app/(app)/layout.tsx`

**Issue:** The whole layout is async and awaits all data (cookies, session, flags, invitations, onboarding) before rendering anything. Sidebar, header, and main shell are blocked until every check completes.

**Skill ref:** §1.5 Strategic Suspense Boundaries.

**Recommendation:** Where possible, render a minimal shell (e.g. sidebar + header skeleton) and wrap only the parts that depend on onboarding/invitation in `<Suspense>`. Redirects (invitation, onboarding) may still need to be handled at layout level; the goal is to show shell faster while those checks run.

---

### 4.2 Good use of Suspense

**File:** `src/app/(app)/agents/[agentId]/jobs/layout.tsx` uses `<Suspense fallback={<JobLayoutSkeleton />}>` and then runs a single `Promise.all` for layout data. This is a good pattern to replicate where a clear boundary exists.

---

## 5. Client-Side & Re-renders (MEDIUM)

### 5.1 useSearchParams / state reads

**Observation:** Many components use `useState` and some use `useSearchParams`. The skill recommends deferring reads of `searchParams` to the point of use (e.g. inside a callback) when the component doesn’t need to re-render on param changes, to avoid unnecessary subscriptions.

**Recommendation:** Audit components that use `useSearchParams` only inside callbacks (e.g. share or submit handlers) and replace with a one-time read (e.g. `new URLSearchParams(window.location.search)`) in the callback to avoid subscribing to param changes.

---

### 5.2 Functional setState and transitions

**Observation:** The codebase uses server components and server actions widely. Where client state is used (e.g. task list drag-and-drop, load more), ensure updates use functional setState and non-urgent updates use `startTransition` where appropriate (skill §5.5, §5.7).

---

## 6. Summary Table

| Category             | Rule / finding                          | Impact   | File(s) / area                      |
| -------------------- | --------------------------------------- | -------- | ----------------------------------- |
| Waterfalls           | App layout 5-step sequential await      | CRITICAL | `(app)/layout.tsx`                  |
| Waterfalls           | Root layout getLocale + getMessages     | MEDIUM   | `layout.tsx`                        |
| Waterfalls           | Task detail session + getTranslations   | MEDIUM   | `tasks/[taskId]/page.tsx`           |
| Waterfalls           | MCP page session + getTranslations      | LOW      | `mcp/page.tsx`                      |
| Server               | No React.cache(getSession)              | HIGH     | `lib/auth/auth.server.ts`                 |
| Server               | taskManagerMenuEnabled calls getSession | HIGH     | `lib/flags/task-manager.ts`, layout |
| Suspense             | Layout blocks full shell                | HIGH     | `(app)/layout.tsx`                  |
| Bundle / third-party | Analytics not deferred                  | MEDIUM   | `layout.tsx`                        |
| Client               | useSearchParams in callbacks            | LOW      | Various client components           |

---

## 6.5 Implementation status (2026-02-09)

- Parallelized async work in `(app)/layout.tsx`, `layout.tsx`, `tasks/[taskId]/page.tsx`, and `mcp/page.tsx`.
- Added per-request session deduplication via `react` `cache()` and kept flags using the cached session.
- Added a Suspense-wrapped redirect guard in `(app)/layout.tsx` to allow the shell to render sooner.
- Deferred Analytics and SpeedInsights with `next/dynamic` and `ssr: false`.
- Removed `useSearchParams` subscriptions where only needed in callbacks.

**Perf report (local dev, `http://localhost:3000/signin?returnUrl=%2F`):**

- Performance score: 0.96
- FCP: 1.2 s
- LCP: 2.6 s
- TTFB (server-response-time): ~80 ms
- TTI: 10.6 s
- Report files: `.cursor/sokosumi-perf.report.html`, `.cursor/sokosumi-perf.report.json`

---

## 7. Suggested order of work

1. **Parallelize app layout** (cookies + session, then Promise.all for the three post-session checks). Measure TTFB/LCP before and after.
2. **Introduce `React.cache(getSession)`** and use it everywhere session is read (including getSessionOrRedirect and taskManagerMenuEnabled).
3. **Parallelize root layout** (getLocale + getMessages) and task detail / MCP pages (session + getTranslations).
4. **Consider Suspense** in the app layout so the shell can render while invitation/onboarding checks run.
5. **Consider dynamic import** for Analytics/SpeedInsights and any other non-critical, heavy client scripts.
6. **Optionally audit** useSearchParams and client setState/transitions for the patterns above.

After each step, re-run the Lighthouse performance report (`pnpm run perf:report`) and compare scores and LCP/FCP to the baseline (e.g. performance ~66, LCP ~10.7s on the sign-in page).

### Authenticated performance report

To profile **authenticated** pages (e.g. `/agents` after login):

```bash
pnpm run perf:report:auth
```

This script launches Chrome (visible), opens the login page, and waits for you to sign in and navigate to the page to audit. When you press Enter, it runs Lighthouse with the same session (cookies preserved) and writes `.cursor/sokosumi-perf.report.html` and `.cursor/sokosumi-perf.report.json`.

Optional env vars:

- `BASE_URL` — base URL (default: preprod URL from `perf:report`)
- `AUDIT_PATH` — single path to audit (default: `/agents`)
- `AUDIT_PATHS` — comma-separated paths to audit in one run (agents, agent detail, tasks, jobs, job detail). Use `{{agentId}}` and `{{jobId}}`; set `AGENT_ID` and `JOB_ID` to substitute.
- `AGENT_ID`, `JOB_ID` — optional; substituted into `AUDIT_PATHS` for agent/job detail URLs.
- `THROTTLE=high-latency` — run with **DevTools network throttling** to simulate a distant user (e.g. Canada): ~400 ms RTT, 1 Mbps down. Report is written to `.cursor/sokosumi-perf-high-latency.report.{html,json}`.

Example (single): `BASE_URL=https://app.example.com AUDIT_PATH=/tasks pnpm run perf:report:auth`

Example (multiple pages — agents, agent detail, tasks, jobs, job detail): set `AUDIT_PATHS` and `AGENT_ID` / `JOB_ID`; sign in once and press Enter to get one report per path (e.g. `sokosumi-perf.report-agents.html`, `sokosumi-perf.report-tasks.html`).

```bash
AUDIT_PATHS="/agents,/agents/{{agentId}},/tasks,/agents/{{agentId}}/jobs,/agents/{{agentId}}/jobs/{{jobId}}" \
  AGENT_ID=cmiyuwmmf000304l18efjfg5o JOB_ID=cmig62ajh000h7hmleefbax5a \
  pnpm run perf:report:auth
```

### Simulating high-latency (e.g. Canada, ~8 s page load)

To reproduce slow page loads reported by users in distant regions:

```bash
THROTTLE=high-latency pnpm run perf:report:auth
```

1. Sign in and navigate to the page to audit (e.g. `/agents`).
2. Press Enter; Lighthouse runs with **real** network throttling (DevTools): 200 ms one-way latency (~400 ms RTT), 1 Mbps down, 0.5 Mbps up, 4× CPU slowdown.
3. Open `.cursor/sokosumi-perf-high-latency.report.html` and compare to the unthrottled report. Focus on:
   - **TTFB** and **LCP** — impact of RTT and throughput
   - **Network waterfall** — many round-trips or large payloads
   - **Main-thread work** — blocking time and long tasks

Use the high-latency report to prioritize: reduce round-trips (e.g. parallel data, caching), shrink critical payloads, and defer non-critical JS.
