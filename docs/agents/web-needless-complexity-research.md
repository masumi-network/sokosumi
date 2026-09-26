# apps/web needless-complexity research

Research-only scan of `apps/web/src` (excluded: generated clients, `node_modules`, `.next`, vendor skills).

Hard skips honored: #5225 project/agent wrappers + archived-rooms; #5239 task-schedule; #4390 oauth2 shim; namefully; onInvalidPreviousResponseId.

## Ranked findings (PR-worthiness)

### 1. personal-assistant vs soko-bot dual naming leftover
- **Paths:** `src/app/(app)/personal-assistant/**`, `src/app/api/personal-assistant/**`, `src/lib/soko-bot/constants.ts` (`SOKO_BOT_ROUTE = "/personal-assistant"`), `src/components/chat/personal-assistant-chrome-store.ts`, `src/app/(app)/components/sidebar/components/personal-assistant-nav*.tsx`, `messages/en.json` (mix of “Personal Assistant” / “Soko Bot”)
- **Why:** Product/domain name is Soko Bot; user route, API poll endpoints, sidebar chrome, and several UI strings still say personal-assistant. Service/actions/Core already use `sokoBot*`. Constant literally aliases the old path.
- **Simplify:** One rename PR: route `/soko-bot` (or keep `/soko-bots` team + `/soko-bot` mine), API `/api/soko-bot/*`, rename nav/chrome store files, align message keys. Redirect old path once.
- **Confidence:** high

### 2. Three parallel “time ago” stacks
- **Paths:** `src/components/time-ago.tsx` (date-fns + `use(browser())`), `src/lib/utils/datetime.ts` + `datetime.client.ts` (`Intl.RelativeTimeFormat` via `useLocalizedDateTime`), `src/lib/utils/notification-time.ts` (`useFormatter().relativeTime`)
- **Why:** Same UX (relative timestamps) with three libraries/APIs and different edge rules (“just now”, Suspense absolute fallback, 7-day cutoff). No user-visible reason for three.
- **Simplify:** One helper on `useFormatter` / `getFormatter` (next-intl rule). Keep Suspense hydration trick in one `TimeAgo` component; delete `formatTimeAgo` path and fold notification formatter into it.
- **Confidence:** high

### 3. Job details / agent chrome boolean layout modes
- **Paths:** `src/components/jobs/job-details/job-details-view.tsx` (`readOnly`, `showAgentHeader`, `publicJobLayout`, …), `src/components/agents/agent-action-buttons.tsx` (`showBackButton`, `showShareButton`, `showCloseButton`)
- **Why:** Boolean matrix for share vs modal vs owned job and for toolbar buttons. Composition skill / AGENTS call this out.
- **Simplify:** Explicit variants: `PublicJobDetailsView`, `ModalJobDetailsView`, `OwnedJobDetailsView`; compound toolbar pieces instead of show* flags.
- **Confidence:** med

### 4. Feature-folder actions vs `src/lib/actions` + inconsistent wire shapes
- **Paths:** `src/app/(app)/{projects,history,tasks,chat}/actions.ts`, `src/app/(app)/projects/components/social-posts/actions.ts`, `src/app/(app)/agents/[agentId]/jobs/actions.ts` vs `src/lib/actions/**`
- **Why:** Pagination/pin actions live beside features and often `throw` or return raw pages; mutations under `lib/actions` use `ActionResultDto`. Same app, two action homes and two error contracts.
- **Simplify:** Pick one home (prefer `lib/actions/<domain>` for mutations; keep colocated load-more only if documented). Standardize load-more on `ActionResultDto` or a single shared page DTO — stop throwing for expected client failures.
- **Confidence:** high

### 5. Chat action Result helper duplication + oversized `chat/actions.ts`
- **Paths:** `src/app/(app)/chat/actions.ts` (~1133 lines: `RoomActionResult` / `roomOk` / `roomFail` / `roomCatch`), `src/components/chat/organization-chat-list.actions.ts` (~170 lines: parallel `OrganizationChatListActionResult` / `listOk` / `roomOk` / `listFail`)
- **Why:** Two thin aliases of `ActionResultDto` + duplicate ok/fail helpers. Sidebar list actions split from room actions without shared helper module.
- **Simplify:** One `toActionResult` usage site (or tiny `chat-action-result.ts`); merge list mutations into `lib/actions/chat` or keep colocated but drop rename aliases. Split god-file by domain (rooms / invites / unread) only after helper unify.
- **Confidence:** high

### 6. Pure-delegate admin service + action sandwiches
- **Paths:** e.g. `src/lib/services/admin-agent.service.ts` + `src/lib/actions/admin-agents/action.ts`; `admin-soko-bot.service.ts` (≈14/15 methods `return *.data`); `developer-tasks/action.ts`; contrast `src/lib/actions/notice/action.ts` (calls `coreClient` directly, no service)
- **Why:** Many admin services only unwrap Core `.data`. Actions then wrap again with `withSession` + `toActionResult`. Notice already skips the empty service — convention drift.
- **Simplify:** Convention PR: if service only unwraps, call Core from the action (notice pattern) **or** keep service but stop pretending every domain needs both. Do not invent a fourth pattern.
- **Confidence:** med

### 7. Presentational `'use client'` leaves that could be RSC
- **Paths:** `src/components/agents/star-rating.tsx` (no hooks/events), `src/app/(app)/history/components/history-type-icon.tsx` (client only because `AgentIcon` is client), likely others in the candidate list from the scan
- **Why:** Unnecessary client boundaries pull islands wider; `StarRating` is pure markup math.
- **Simplify:** Drop `'use client'` from pure presentational components. Split `AgentIcon` so the Bot fallback is server-safe; keep `ResolverSVGIcon` client-only.
- **Confidence:** med (StarRating high; AgentIcon split med)

### 8. Dual Result shape: `BetterAuthClientResult` vs `ActionResultDto`
- **Paths:** `src/lib/actions/errors/better-auth.ts` (`{ data, error }`), `src/components/common/modal-context.tsx`, `src/components/members-table/member-actions-modal-context.tsx` (maps `ActionResultDto` seat unassign back into `{ data: null, error }`)
- **Why:** Auth client shape is real; modal factory hard-codes it, so server-action results get manually reshaped. Second Result dialect beside the documented `ActionResultDto`.
- **Simplify:** Make `createModalContext` accept `ActionResultDto` (or a tiny adapter at the boundary only). Stop hand-building `{ data, error }` for Core-backed seat actions.
- **Confidence:** med

### 9. `GlobalModalsContext` packs unrelated modals
- **Paths:** `src/components/modals/global-modals-context.tsx`; calendar upgrade callers only under `src/app/(app)/tasks/components/*`; logout under you-page + account menu
- **Why:** App-wide provider for a tasks-only calendar upgrade modal. Extra context surface for one feature.
- **Simplify:** Keep logout global; mount calendar upgrade modal under tasks tree (local state or tasks provider).
- **Confidence:** med

### 10. Bare `toLocaleDateString` in job date pickers
- **Paths:** `src/components/job-input/inputs/date-input.tsx`, `datetime-input.tsx` (button label via `toLocaleDateString()`); contrast `useFormatter` / `formatDateValue`
- **Why:** Violates web i18n-formatting rule; default locale can hydrate-mismatch; duplicates display formatting already elsewhere.
- **Simplify:** `useFormatter().dateTime(...)` for the trigger label; keep `formatDateValue` for wire values only.
- **Confidence:** high

### 11. Notice hydration: dual providers + action with no service
- **Paths:** `src/contexts/account-notice-provider.tsx`, `src/app/(app)/components/notice-dialog-context.tsx`, `src/lib/actions/notice/action.ts`, `app-shell-overlays.tsx` / `shell-hydrators.client.tsx`
- **Why:** Two hydration contexts (account notice vs legal/announcement dialogs) with prop→state “hydrate path owns updates” machinery. Action skips service (fine) but notice domain is split across shell files.
- **Simplify:** One notice module owning pending fetch + hydrate + dialog open. Keep Route/Action choice; collapse the two provider pairs if both only feed notification chrome.
- **Confidence:** low–med (shell/instant constraints may justify split)

### 12. `StarRating` / members `showSeatManagement` boolean toggles
- **Paths:** `src/components/agents/star-rating.tsx` (`showRatingNumber`, optional `totalRatings`), `src/components/members-table/members-table.tsx` + `seat-management-context.tsx` (`showSeatManagement`)
- **Why:** Small boolean API forks. Seat context also carries real optimistic seat math (that part is not needless).
- **Simplify:** `StarRating` vs `StarRatingWithCount` variants; pass seat chrome as composed column set rather than `showSeatManagement` flag (keep optimistic helpers).
- **Confidence:** med (small PR; lower impact than 1–5)

## Checklist items with little/no smell found

- **Re-export passthrough files:** Outside generated clients, almost no `export … from` passthrough layers. `lib/utils/index.ts` is `cn` only (real module). Avoid-re-exports debt looks largely paid.
- **`result.data` on ActionResultDto:** No systematic `@/lib/ts-res` revival. Remaining `result.data` hits are Zod `.safeParse`, Better Auth client, or Core client envelopes — not a second action Result algebra (except BetterAuth bridge in #8).

## Not fully walked

- `rooms-client.tsx` and full chat realtime state machines
- Entire billing/credits/subscription UI
- design-md dialog state
- notification-provider internals beyond file inventory
- Every admin panel client
- Full `core.shared.ts` / generated transformers
- Apple / Core apps (out of slice)
- Whether `/personal-assistant` redirect already exists in proxy/middleware (not verified end-to-end)
