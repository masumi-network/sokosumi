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

Product code in Web and CMO never calls `useEffect`, `useLayoutEffect`, or `useMountEffect` directly (named import or `React.*` form). `biome-plugins/no-direct-effects.grit` warns across product files and `biome-plugins/no-effect-aliases.grit` errors on aliases and indirections ([ADR-0075](../adr/0075-effects-live-only-in-named-hooks.md)); locally `pnpm effects:check` (run in Husky pre-commit) enforces each app's `effect-baseline.json` (sorted, one entry per line — the only file a migration PR updates), and CI's `Biome` job runs the full `scripts/ci/__tests__/no-direct-effects.test.mjs` suite against the base SHA (`EFFECT_BASELINE_BASE_REF`) to reject any baseline growth or `biome-ignore` suppression for the effect rules.

Before reaching for an effect, read React's [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) and [Separating Events from Effects](https://react.dev/learn/separating-events-from-effects), and prefer:

- **Derived values**: compute during render (or `useMemo` only when expensive) instead of syncing state.
- **User actions**: run side effects in event handlers rather than watching a state flag.
- **Resetting state on prop change**: pass a `key` to remount the subtree cleanly.
- **Data loading**: use `@tanstack/react-query` (or Server Components / loaders) instead of `fetch` + `setState` in an effect.
- **External store subscriptions**: use `useSyncExternalStore` for browser state (`matchMedia`, `visualViewport`, `localStorage`, hydration checks).
- **Latest callback or prop inside an effect**: use `useEffectEvent`, and call it only from that effect or from callbacks the effect registers (its timers, listeners, subscriptions). A callback registered outside an effect (a JSX event handler, a library callback, a timer started in a handler) that needs the latest committed value uses `useLatestRef` from `src/hooks/effects/`. Render logic reads current props and state directly, never a ref.

When you genuinely need to synchronize with an external system, call an existing named hook from `src/hooks/effects/` (or add one there — one job per hook, covered by a Vitest behaviour test, and never taking a general effect-callback parameter). Tests, test fixtures, and Web's vendored `src/components/ui/**` are exempt.

Named hooks in `apps/web/src/hooks/effects/` (CMO keeps its own under `apps/cmo/src/hooks/effects/`):

- `use-mobile` (`useIsMobile`, `useIsMobileMedia`, `MOBILE_BREAKPOINT`) — mobile viewport media query
- `use-media-query` (`useMediaQuery`, `usePrefersReducedMotion`, `matchesMediaQuery`, `subscribeMediaQuery`) — generic CSS media query and live `prefers-reduced-motion` subscriptions (CMO has `useMediaQuery` under `apps/cmo/src/hooks/effects/use-media-query.ts`)
- `use-animation-frame` (`useAnimationFrame`) — `requestAnimationFrame` loop with elapsed seconds per frame
- `use-event-listener` (`useEventListener`) — typed window, document, or element DOM event listener using the latest handler (CMO has `useEventListener` under `apps/cmo/src/hooks/effects/use-event-listener.ts`)
- `use-interval` (`useInterval`) — repeating timer paused on `null` delay (CMO has `useInterval` under `apps/cmo/src/hooks/effects/use-interval.ts`)
- `use-timeout` (`useTimeout`) — one-shot timer paused on `null` delay with optional `resetKey` (CMO has `useTimeout` under `apps/cmo/src/hooks/effects/use-timeout.ts`)
- `use-scheduled-timeout` (`useScheduledTimeout`, `useScheduledTimeoutMap`) — imperative handler-started timeout(s) with synchronous cancel and unmount cleanup
- `use-abort-controller` (`useAbortController`, `useAbortControllers`) — imperative handler-started `AbortController`(s) aborted on unmount or `resetKey` change
- `use-replace-route-on-media` (`useReplaceRouteOnMedia`) — one-shot `router.replace` when a CSS media query matches
- `use-keyboard-open` (`useKeyboardOpen`) — soft keyboard open state via `visualViewport`
- `use-clipboard` (`useClipboard`, `copyTextWithToast`) — clipboard write with toast feedback and timed reset
- `use-load-when-visible` (`useLoadWhenVisible`) — `IntersectionObserver` pagination boundary trigger
- `use-intersection-observer` (`useIntersectionObserver`) — live-element `IntersectionObserver` subscription with unmount disconnect
- `use-resize-observer` (`useResizeObserver`, `useLayoutResizeObserver`) — live-element `ResizeObserver` subscriptions with unmount disconnect
- `use-mutation-observer` (`useMutationObserver`, `useLayoutMutationObserver`) — live-node / `"body"` / `"documentElement"` `MutationObserver` subscriptions with unmount disconnect
- `use-drag-to-scroll` (`useDragToScroll`) — horizontal pointer drag scrolling
- `use-focus-when` (`useFocusWhen`, `useLayoutFocusWhen`) — focus `targetRef.current` when a condition turns true (reads the ref at effect time; optional `preventScroll`, `deferToFrame`, and `resetKey`)
- `use-scroll-into-view-when` (`useScrollIntoViewWhen`) — scroll a ref or getter target into view when a condition turns true (reads the target at effect time; optional reduced-motion downgrade and `resetKey`; CMO has `useScrollIntoViewWhen` under `apps/cmo/src/hooks/effects/use-scroll-into-view-when.ts`)
- `use-scroll-to-end` (`useScrollToEnd`) — scroll `targetRef.current` to its vertical or horizontal end when a trigger changes
- `use-page-search-shortcut` (`usePageSearchShortcut`) — Cmd/Ctrl+F search input focus shortcut
- `use-prevent-enter-submit` (`usePreventEnterSubmit`) — form Enter submission guard
- `use-intent-prefetch` (`useIntentPrefetch`) — ForesightJS pointer-intent route prefetching
- `use-chat-unread-document-title` (`useChatUnreadDocumentTitle`) — browser tab unread count prefix
- `use-self-presence` (`useSelfPresence`) — local online/AFK/offline presence tracking
- `use-org-presence-map` (`useOrgPresenceMap`, `useOrgPresenceMapSync`, `createOrgPresenceStore`) — Ably organization presence subscription backed by an external store
- `use-org-presence-publisher` (`useOrgPresencePublisher`) — Ably organization presence publishing and channel lifecycle for the active organization
- `use-room-typing` (`useRoomTyping`, `useRoomTypingSync`, `createRoomTypingStore`) — Ably room typing subscription and publisher backed by an external store
- `use-calendar-realtime` (`useCalendarRealtime`) — Ably workspace calendar invalidation, capability checks, and access-revocation subscription
- `use-chat-control-channel` (`useChatControlChannel`) — ref-counted Ably user chat control channel subscription for revoke and rooms-changed signals
- `use-selected-room-channel-health` (`useSelectedRoomChannelHealth`) — Ably connection and selected room channel health/continuity observer
- `use-notification-front-presence` (`useNotificationFrontPresence`) — tab-visibility presence reporting on the user's Ably notifications channel
- `use-notification-realtime` (`useNotificationRealtime`) — Ably notifications channel subscription and attachment reconciliation
- `use-push-recovery` (`usePushRecovery`) — throttled web push subscription self-healing on foreground return and reconnect
- `use-files-archive-download` (`useFilesArchiveDownload`) — zip download aborted on unmount
- `use-location-replace` (`useLocationReplace`) — `window.location.replace` redirect when a target URL is set
- `use-format-toolbar-open-preference` (`useFormatToolbarOpenPreference`) — before-paint chat formatting toolbar preference read and persistence
- `use-normalized-query-tab` (`useNormalizedQueryTab`) — URL query tab validation against enabled tabs with invalid-URL cleanup
- `use-unauthenticated-error-handler` (`useUnAuthenticatedErrorHandler`) — `/signin` redirect for unauthenticated error boundaries
- `use-latest-ref` (`useLatestRef`) — ref synced to the latest committed value in a layout effect
- `use-query-error-report` (`useQueryErrorReport`) — calls a query error reporter once per failure while mounted on the active key
- `use-flash-toast` (`queueFlashSuccessToast`, `useFlashToast`) — shows a one-time `sessionStorage` success toast once on the next document mount
- `use-mark-agent-unavailable` (`useMarkAgentUnavailable`, `useIsAgentUnavailable`) — ref-counted unavailable-agent external store for mobile header back fallback
- `use-project-scope-marker` (`useProjectScopeMarker`, `useMarkedProjectSnapshot`) — detail-page project scope marker store keyed by detail path
- `use-personal-assistant-chrome-visible` (`usePersonalAssistantChromeVisible`) — records session visibility of Personal Assistant sidebar chrome for Instant `/chat`
- `use-failed-soko-bot-id-publisher` (`useFailedSokoBotIdPublisher`) — before-paint failed Soko Bot id publishing to synchronize sidebar and Direct rows
- `use-remember-pinned-rooms` (`useRememberPinnedRooms`) — persists the sidebar's Pinned chat rooms in session memory across workspace switches
- `use-membership-visible-rooms-publisher` (`useMembershipVisibleRoomsPublisher`) — publishes sidebar live rooms and registers the active publisher without bouncing live count on room updates
- `use-auth-session-hydration` (`useAuthSessionHydration`) — before-paint `authClient` session hydration and rendered-user registration
- `use-pending-navigation` (`usePendingNavigation`) — optimistic destination tracking for in-flight Next.js navigation transitions
- `use-pending-created-tasks` (`usePendingCreatedTasks`, `withBoardPreview`) — optimistic pending task board preview registration while a task create transition runs
- `use-track-view` (`useTrackView`) — fires a typed GTM view event (`view_login_area`, `view_register_area`, `view_credits`, `view_agent`) once on mount or when an explicit key changes
- `use-analytics-user-id` (`useAnalyticsUserId`) — pushes GA4 `set_user_id` into `window.dataLayer` when the signed-in user id changes
- `use-track-purchase` (`useTrackPurchase`) — fires the GTM `purchase` event at most once per checkout session id once analytics consent is granted
- `use-report-route-error` (`useReportRouteError`, `useGlobalRouteError`) — reports route error boundary failures to Sentry and handles one-shot stale-deployment refresh in the global error boundary
- `use-router-redirect` (`useRouterRedirect`) — client-side Next.js App Router navigation (`replace`/`push`, optional one-shot) driven by state
- `use-url-timezone` (`useUrlTimezone`) — seeds the browser's IANA time zone into a calendar URL that lacks a valid one
- `use-push-preference` (`usePushPreference`) — browser Web Push capability, permission, subscription, and repair state synchronization
- `use-record-project-visit` (`useRecordProjectVisit`) — records visited project IDs in the per-user/per-workspace `localStorage` visit log
- `use-record-page-visit` (`useRecordPageVisit`) — increments the per-pathname likely-pages visit counter on mount
- `use-remembered-project-scope` (`useRememberedProjectScope`) — `sessionStorage` external store and workspace-switch-guarded project scope synchronization
- `use-tasks-restored-view-url` (`useTasksRestoredViewUrl`, `rememberSavedTasksView`, `forgetSavedTasksView`, `withTasksView`) — before-paint restored Tasks view URL synchronization via `history.replaceState` / `router.replace`
- `use-calendar-week-row-label` (`useCalendarWeekRowLabel`) — sets localized ISO week `aria-label` on FullCalendar month week rows

### React Query in migrations

When migrating a client fetch effect to React Query in `apps/web`:

- **Session boundary (full document load):** User changes — sign-out via `signOutWithPushRelease` and every sign-out caller (`logout-modal`, `workspace-gate-sign-out`, `invitation-actions`, `oauth-hand-back`, password-reset sign-out), account deletion, sign-in (`finishAuthInPlace` / OAuth callbacks), impersonation start/stop, and session-expiry redirects (`AuthSessionGuard`, `useUnAuthenticatedErrorHandler`) — always end in a full document load (`window.location.assign`, `window.location.replace`, or `window.location.reload`) instead of a client router push/refresh. No in-memory JS cache (including the module `QueryClient`) outlives its user.
- **Scoped reads (`useScopedQuery` / `useScopedInfiniteQuery` in `apps/web/src/queries/scoped-queries.ts`):**
  - Pass `scope` explicitly using the exact same value the request uses (organization slug or workspace id, plus viewer id where the server filters per member); the wrapper prepends `scope` to `queryKey`.
  - Defaults to `networkMode: "always"`, `retry: false`, and `refetchOnWindowFocus: false` without changing global `QueryClient` defaults for existing `useQuery` callers.
  - `placeholderData` / `keepPreviousData` is intentionally disallowed and stripped so scope A's rows can never render under scope B while loading.
  - Pass `onError` to toast or report failures: `useQueryErrorReport` fires only while the observer is mounted, enabled (`result.isEnabled`), and still on the failing key, so an abandoned or disabled read cannot toast on another screen.
- **Writes alongside migrated reads:** Cancel every query under the scoped key prefix before the write; on success apply the result only to already-loaded entries (`status === "success"` — a write's result never marks a failed or unloaded list as loaded), then invalidate that prefix. Keep one-time secrets in the create result/local UI state and never write them into the React Query cache.
- **Still on their old code:** Write-heavy, protected-preview, public-share, and one-time-secret surfaces stay on their current code rather than migrating to React Query.
