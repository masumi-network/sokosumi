# Web UI conventions

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

### UI & Styling

- **Brand**: Read [`apps/web/DESIGN.md`](../../apps/web/DESIGN.md) for visual intent (tone, elevation, motion, voice) before styling. Token values live in `apps/web/src/app/globals.css`, which wins on conflict.
- **Brand direction**: The [Masumi Family brand guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide) is the source of truth for brand and UI across Masumi, Sokosumi and CMO.XYZ: Iris Flower `#FF51FF` as the one primary with Neutral 950 text on it, shared neutrals, no glow or blur. `apps/web/src/app/globals.css` carries its values, so Iris is a fill only: never text or a thin mark on the page (2.67:1 on white). The one exception is the navigation progress bar (`apps/web/DESIGN.md`, **Motion**). Preview the system, rendered with our real components, at `/admin/design-system` (platform admins).
- **Page layout**: Every app page is white, holds its content in borderless light-gray panels
  (`HOLDER_CLASS` in `apps/web/src/components/ui/holder-surface.ts`), puts white bordered components on them, and fills the width: no centred
  `mx-auto max-w-*` page column, except the entry page and the chat room reading column.
  See **Page surfaces** and **Fill the width** in
  [`apps/web/DESIGN.md`](../../apps/web/DESIGN.md).
- **Components**: Use Shadcn UI and Radix UI primitives
- **Styling**: Tailwind CSS with responsive design
- **Colors**: Use semantic tokens from `globals.css`. Never a raw Tailwind palette color
  (`bg-emerald-500`, `text-gray-400`, `bg-black`), never a hex/rgb/hsl literal, and never an
  opacity modifier on a color utility (`bg-primary/55`, `border-border/40`, `bg-primary/[0.04]`).
  Use the neutral step instead (`border-border` edge, `bg-quinary` hover, `bg-muted` fill;
  green, yellow and Iris are fills only); if no step fits, add one to both theme blocks **and** bridge it in `@theme inline`,
  or the utility silently emits nothing. See
  [Color tokens](../../.cursor/rules/color-tokens.mdc).
- **Sizing**: Use `size-4` instead of `h-4 w-4`
- **Themes**: Ensure compatibility with both dark and light modes
- **Dynamic Type (iOS/macOS)**: Root rem may track Apple Dynamic Type (`-apple-system-body`); Inter stays the face; scale capped at **1.25×** (max 20px root). See `.cursor/rules/dynamic-type.mdc` and `apps/web/src/lib/utils/dynamic-type.ts`.
- **Font sizes**: Never set a literal font size in product UI: no arbitrary `text-[…]` in any unit (`text-[10px]`; `text-[0.8125rem]` is the same off-scale 13px), no `text-[length:…]` or `text-(length:…)`, and no literal `font-size`/`fontSize` in px, rem or em (`font-size: 12px`, `fontSize: "0.875rem"`, `fontSize: 14`). Use a scale step: `text-2xs` (11px, dense meta and badges only) through `text-4xl`. They are rem, so type scales with root. `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts` fails each spelling and lists the few exceptions with their reason.
- **Viewport heights**: Use `dvh` for viewport-sized shells, never `svh`, `vh`, `lvh` or `h-screen`. In an iOS home-screen web app WebKit reports `svh` off by the status-bar height, which Safari and Chromium never show. `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts` fails each spelling. Verify Web layout with [Verifying Web UI](../../apps/web/docs/verification.md).
- **Whole pixels**: Never a fractional `px` on a layout or border length (`p-[1.5px]`, `padding: 1.5px`, `border: "0.2px solid …"`). A 1x display has no half pixel, so the browser rounds a `1.5px` border to 1px on one edge and 2px on the other. Shadow radii, keyframe translations and unitless scale factors stay continuous. See [Whole pixels](../../.cursor/rules/whole-pixels.mdc).

### Key Conventions

- **URL State**: Use `nuqs` for URL search parameter state management
- **Client Components**: Limit `'use client'` usage
  - Favor server components and Next.js SSR
  - Use only for Web API access in small components
  - Avoid for data fetching or state management
- **Async Operations**: Use Suspense for async operations
- **Loading buttons**: Pass `loading` to the `Button` whose request is running; it keeps the label, icon and width and draws the sweeping bar. Confirm dialogs use `AlertDialogAction loading`; buttons `Button` cannot render draw `ButtonLoadingBar`. Two gotchas: a submit button inside `<fieldset disabled>` is natively disabled, so place it outside the fieldset; a loading button inside a Radix `…Trigger asChild` needs `disabled` on the trigger, or the menu still opens.
- **`asChild` state classes**: On an `asChild` primitive (`SidebarMenuButton asChild`), classes that must override its own `hover:`/`active:` fills go on the primitive's `className`. The primitive merges its variants with that prop through `cn()`; the Radix Slot only appends the child's classes, so both fills ship and the primitive's can win. Test against the real primitive: a mocked one cannot show the merge.
- **Data Fetching**: Follow Next.js docs for Data Fetching, Rendering, and Routing
- **Accessible names in shared components**: an ancestor with `aria-label` replaces its descendants' text, and one with `aria-hidden` removes it. An `sr-only` label inside a shared component therefore reaches only the call sites without either, so check every call site. happy-dom computes a name from `aria-label` on a roleless `<span>`, which browsers ignore, so assert the markup as well as `toHaveAccessibleName`.
- **`PopoverAnchor` instead of `PopoverTrigger`**: Radix treats the anchor as outside the content and has no trigger to return focus to. Guard `onFocusOutside` and `onPointerDownOutside` against events from the anchor, and pass an `onCloseAutoFocus` that calls `preventDefault()` and focuses the anchor, or a hotkey-opened popover closes at once and focus drops to `<body>` (`apps/web/src/app/(app)/chat/components/room-search-panel.tsx`).

## Effects

Product code in Web and CMO never calls `useEffect` or `useLayoutEffect` directly (named import or `React.*` form), and never wraps them in a general effect-callback hook (the former `useMountEffect` wrapper is deleted and remains blocked by Biome). `biome-plugins/no-direct-effects.grit` warns across product files and `biome-plugins/no-effect-aliases.grit` errors on aliases and indirections ([ADR-0075](../adr/0075-effects-live-only-in-named-hooks.md)); locally `pnpm effects:check` (run in Husky pre-commit) enforces each app's `effect-baseline.json` (sorted, one entry per line — the only file a migration PR updates), and CI's `Biome` job runs the full `scripts/ci/__tests__/no-direct-effects.test.mjs` suite against the base SHA (`EFFECT_BASELINE_BASE_REF`) to reject any baseline growth or `biome-ignore` suppression for the effect rules.

Before reaching for an effect, read React's [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) and [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects), and prefer:

- **Derived values**: compute during render (or `useMemo` only when expensive) instead of syncing state.
- **User actions**: run side effects in event handlers rather than watching a state flag.
- **Resetting state on prop change**: pass a `key` to remount the subtree cleanly.
- **Data loading**: use `@tanstack/react-query` (or Server Components / loaders) instead of `fetch` + `setState` in an effect.
- **External store subscriptions**: use `useSyncExternalStore` for browser state (`matchMedia`, `visualViewport`, `localStorage`, hydration checks).
- **Latest callback or prop inside an effect**: use `useEffectEvent`, and call it only from that effect or from callbacks the effect registers (its timers, listeners, subscriptions). A callback registered outside an effect (a JSX event handler, a library callback, a timer started in a handler) that needs the latest committed value uses `useLatestRef` from `src/hooks/effects/`. Render logic reads current props and state directly, never a ref.

When you genuinely need to synchronize with an external system, host the effect in a **single-site, owner-named hook** under `src/hooks/effects/` (one job per hook, named for its owner and job, covered by a Vitest behaviour test, and never taking a general effect-callback or setter-forwarding parameter). Single-site owner-named hooks are the standard way to host an effect: do not generalize a single-site effect into a reusable API, and reach for a shared hook from `src/hooks/effects/` (`useEventListener`, `useInterval`, `useTimeout`, observer hooks) only when its semantics match the site identically (for example, `useEventListener` and `useInterval` always call the latest handler rather than binding a callback at effect setup). Tests, test fixtures, and Web's vendored `src/components/ui/**` are exempt.

Shared hooks in `apps/web/src/hooks/effects/` (CMO keeps its own under `apps/cmo/src/hooks/effects/`; single-site owner-named hooks live beside them and are not listed here):

- `use-mobile` (`useIsMobile`, `useIsMobileMedia`, `MOBILE_BREAKPOINT`) — mobile viewport media query
- `use-media-query` (`useMediaQuery`, `usePrefersReducedMotion`, `matchesMediaQuery`, `subscribeMediaQuery`) — generic CSS media query and live `prefers-reduced-motion` subscriptions (CMO has `useMediaQuery` under `apps/cmo/src/hooks/effects/use-media-query.ts`)
- `use-animation-frame` (`useAnimationFrame`) — `requestAnimationFrame` loop with elapsed seconds per frame
- `use-animation-frame-batch` (`useAnimationFrameBatch`) — batches handler-pushed items into a single `requestAnimationFrame` callback with unmount cancel
- `use-event-listener` (`useEventListener`) — typed window, document, or element DOM event listener using the latest handler (CMO has `useEventListener` under `apps/cmo/src/hooks/effects/use-event-listener.ts`)
- `use-interval` (`useInterval`) — repeating timer paused on `null` delay with optional `immediate` and `resetKey` (CMO has `useInterval` under `apps/cmo/src/hooks/effects/use-interval.ts`)
- `use-timeout` (`useTimeout`) — one-shot timer paused on `null` delay with optional `resetKey` (CMO has `useTimeout` under `apps/cmo/src/hooks/effects/use-timeout.ts`)
- `use-scheduled-timeout` (`useScheduledTimeout`, `useScheduledTimeoutMap`) — imperative handler-started timeout(s) with synchronous cancel and unmount cleanup
- `use-abort-controller` (`useAbortController`, `useAbortControllers`) — imperative handler-started `AbortController`(s) aborted on unmount or `resetKey` change
- `use-replace-route-on-media` (`useReplaceRouteOnMedia`) — one-shot `router.replace` when a CSS media query matches
- `use-keyboard-open` (`useKeyboardOpen`) — soft keyboard open state via `visualViewport`
- `use-clipboard` (`useClipboard`, `copyTextWithToast`) — clipboard write with toast feedback and timed reset
- `use-load-when-visible` (`useLoadWhenVisible`) — `IntersectionObserver` pagination boundary trigger
- `use-intersection-observer` (`useIntersectionObserver`) — live-element `IntersectionObserver` subscription with unmount disconnect
- `use-resize-observer` (`useResizeObserver`, `useLayoutResizeObserver`) — live-element `ResizeObserver` subscriptions with unmount disconnect
- `use-mutation-observer` (`useLayoutMutationObserver`) — live-node / `"body"` / `"documentElement"` `MutationObserver` subscriptions with unmount disconnect
- `use-drag-to-scroll` (`useDragToScroll`) — horizontal pointer drag scrolling
- `use-focus-when` (`useFocusWhen`, `useLayoutFocusWhen`) — focus a ref or getter target when a condition turns true (reads the target at effect time; optional `preventScroll`, `deferToFrame`, and `resetKey`)
- `use-focus-form-field-on-mount` (`useFocusFormFieldOnMount`) — focus a `react-hook-form` field once on mount (or Activity reveal)
- `use-scroll-into-view-when` (`useScrollIntoViewWhen`) — scroll a ref or getter target into view when a condition turns true (reads the target at effect time; optional reduced-motion downgrade and `resetKey`; CMO has `useScrollIntoViewWhen` under `apps/cmo/src/hooks/effects/use-scroll-into-view-when.ts`)
- `use-scroll-child-into-view-x` (`useScrollChildIntoViewX`) — horizontally scroll a container's `scrollLeft` just enough to reveal a matched child without moving vertical page scroll
- `use-scroll-to-end` (`useScrollToEnd`) — scroll `targetRef.current` to its vertical or horizontal end when a trigger changes (CMO also has `useFocusFirstInvalid` under `apps/cmo/src/hooks/effects/use-focus-first-invalid.ts`)
- `use-page-search-shortcut` (`usePageSearchShortcut`) — Cmd/Ctrl+F search input focus shortcut
- `use-prevent-enter-submit` (`usePreventEnterSubmit`) — form Enter submission guard
- `use-intent-prefetch` (`useIntentPrefetch`) — ForesightJS pointer-intent route prefetching
- `use-self-presence` (`useSelfPresence`) — local online/AFK/offline presence tracking
- `use-org-presence-map` (`useOrgPresenceMap`, `useOrgPresenceMapSync`, `createOrgPresenceStore`) — Ably organization presence subscription backed by an external store
- `use-room-typing` (`useRoomTypingSync`, `createRoomTypingStore`) — Ably room typing subscription and publisher backed by an external store
- `use-notification-realtime` (`useNotificationRealtime`) — Ably notifications channel subscription and attachment reconciliation
- `use-files-archive-download` (`useFilesArchiveDownload`) — zip download aborted on unmount
- `use-location-replace` (`useLocationReplace`) — `window.location.replace` redirect when a target URL is set
- `use-format-toolbar-open-preference` (`useFormatToolbarOpenPreference`) — before-paint chat formatting toolbar preference read and persistence
- `use-normalized-query-tab` (`useNormalizedQueryTab`) — URL query tab validation against enabled tabs with invalid-URL cleanup
- `use-unauthenticated-error-handler` (`useUnAuthenticatedErrorHandler`) — `/signin` redirect for unauthenticated error boundaries
- `use-latest-ref` (`useLatestRef`) — ref synced to the latest committed value in a layout effect
- `use-query-error-report` (`useQueryErrorReport`) — calls a query error reporter once per failure while mounted on the active key
- `use-flash-toast` (`queueFlashSuccessToast`, `useFlashToast`) — shows a one-time `sessionStorage` success toast once on the next document mount
- `use-pending-created-tasks` (`usePendingCreatedTasks`, `withBoardPreview`) — optimistic pending task board preview registration while a task create transition runs
- `use-track-view` (`useTrackView`) — fires a typed GTM view event (`view_login_area`, `view_register_area`, `view_credits`, `view_agent`) once on mount or when an explicit key changes
- `use-report-route-error` (`useReportRouteError`, `useGlobalRouteError`) — reports route error boundary failures to Sentry and handles one-shot stale-deployment refresh in the global error boundary
- `use-router-redirect` (`useRouterRedirect`) — client-side Next.js App Router navigation (`replace`/`push`, optional one-shot) driven by state
- `use-quiet-hover-while-scrolling` (`useQuietHoverWhileScrolling`, `CHAT_SCROLLING_ATTRIBUTE`) — marks a chat transcript scroller with `data-chat-scrolling` while scrolling and clears after settle

### React Query in migrations

When migrating a client fetch effect to React Query in `apps/web`:

- **Session boundary (full document load):** User changes — sign-out via `signOutWithPushRelease` and every sign-out caller (`logout-modal`, `workspace-gate-sign-out`, `invitation-actions`, `oauth-hand-back`, password-reset sign-out), account deletion, sign-in (`finishAuthInPlace` / OAuth callbacks), impersonation start/stop, and session-expiry redirects (`AuthSessionGuard`, `useUnAuthenticatedErrorHandler`) — always end in a full document load (`window.location.assign`, `window.location.replace`, or `window.location.reload`) instead of a client router push/refresh. No in-memory JS cache (including the module `QueryClient`) outlives its user.
- **Scoped reads (`useScopedQuery` / `useScopedInfiniteQuery` in `apps/web/src/queries/scoped-queries.ts`):**
  - Pass `scope` explicitly using the exact same value the request uses (organization slug or workspace id, plus viewer id where the server filters per member); the wrapper prepends `scope` to `queryKey`.
  - Defaults to `networkMode: "always"`, `retry: false`, and `refetchOnWindowFocus: false` without changing global `QueryClient` defaults for existing `useQuery` callers.
  - `placeholderData` / `keepPreviousData` is intentionally disallowed and stripped so scope A's rows can never render under scope B while loading.
  - Pass `onError` to toast or report failures: `useQueryErrorReport` fires only while the observer is mounted, enabled (`result.isEnabled`), and still on the failing key, so an abandoned or disabled read cannot toast on another screen.
- **Writes alongside migrated reads (non-Drive):** Cancel every query under the scoped key prefix before the write; on success apply the result only to already-loaded entries (`status === "success"` — a write's result never marks a failed or unloaded list as loaded), then invalidate that prefix. Keep one-time secrets in the create result/local UI state and never write them into the React Query cache. (Does not apply to Drive — Drive uses `invalidateDrive` after a successful write, per the rule below.)
- **Drive cache (`apps/web/src/queries/drive.ts`):** Every Drive list read uses `driveQueryKeys` with `useScopedQuery` / `useScopedInfiniteQuery` scoped to the Drive store (`{ scope: "me" }` or `{ scope: "org", organizationId }`). Every Drive write calls `invalidateDrive(queryClient, store, { deletedIds })` after it succeeds, without awaiting it in the UI: it cancels in-flight reads on the store prefix, removes `deletedIds` from already-loaded entries, and invalidates the prefix (deletes also invalidate on error; batch writes invalidate once if at least one item succeeded). Protected Drive surfaces (file detail, share link, and text preview content) stay outside the cache in named hooks under `apps/web/src/hooks/effects/` that abort on unmount.
- **Chat cache (`apps/web/src/queries/chat.ts`):** Every chat query key comes from `chatQueryKeys`, keeping the exact identity of the read it replaces (no extra workspace scope). The Room roster key is user, workspace, room, and a per-promise id: await its Next Flight thenable with `try`/`catch`, keep the previous result only for the same user, workspace, and room, and never let a later-settling older promise replace a newer one. The refresh scheduler owns scheduled refreshes, and sidebar collections (active, archived, invitations) stay in its local state; the Thread list reads per panel visit (visit id in the key), while the roster follows its server promise. For realtime events, the Open-room Transcript patch and revoked-room removal are the only cache patches; a revocation starts no extra Elsewhere GET; it records a revision so older list responses drop the room. Remove only your own listener on shared Ably channels — never detach a channel your hook does not own — and keep client refetch paths to those `main` already has.
- **Still on their old code:** Chat sidebar collections, write-heavy surfaces outside Drive, protected-preview, public-share, and one-time-secret surfaces stay on their current code rather than migrating to React Query.
