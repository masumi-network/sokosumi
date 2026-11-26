# MCP UI style review (SOKD-475)

Last updated: 2026-11-26

Each view next to the Web screen it renders, with what differed before SOKD-475. Owner decision: views look like Web in every host; only light or dark follows the host ([ADR 0083 amendment](../../../docs/adr/0083-mcp-ui-is-an-optional-rendering-of-a-tool-result.md)).

Phase 1 (this PR) fixes the shared base, the Tasks board and Task detail. Phase 2 restyles the rest after the owner approves the direction.

## Every view (shared base) — fixed in phase 1

- **Host style wins.** Host style variables replaced Sokosumi's tokens, so in Claude and ChatGPT the views took the host's background, text, border and font. Now only `theme` is read.
- **System font.** Web uses Inter. Now an Inter subset is embedded and loaded from bytes (`src/shell/font.ts`).
- **Too few tokens.** Only 11 of Web's tokens existed, so views could not use `card-background`, `muted`, `control-border`, the status hues or the semantic discs. Now 24, checked against Web by `tokens.test.ts`.
- **Buttons.** Outline focus and 60% disabled; Web uses one ring (`ring-2 ring-offset-2`), the press scale and 50% disabled. Now `PrimaryButton` and `QuietButton` are Web's `primary` and `ghost`. Heights stay 44px for touch (Web: 40px).
- **No glyphs.** Statuses were words only; Web uses `lucide-react` glyphs on hue discs. Now shared through `lucide-react`.

## Tasks board

Web: `apps/web/src/app/(app)/tasks/components/kanban-board.tsx`, `kanban-column.tsx`, `column-header.tsx`, `task-card.tsx`, `task-status-badge.tsx`, `task-list-view.tsx`.

Before:

- A flat list under muted `text-xs` headings. Web has columns: `bg-card-background rounded-xl`, 260–280px wide, scrolling sideways.
- Column headers had no status dot. Web shows a `size-2` dot in the column's hue, a `text-sm font-medium` title and a muted count.
- Rows were text, not cards. Web's card is `bg-background border rounded-lg p-3`, with a hover border and shadow.
- The status was a word in a `·` line. Web shows the status marker, and the word only where the column title does not already name it.
- No priority glyph. Web shows signal bars or the urgent square.
- Due date as "Due Nov 28, 2026". Web shows "Due Nov 28" with a calendar glyph, and "Overdue · Nov 26" in foreground once past.
- The avatar was a bordered 28px initials circle. Web's is 20px, `bg-muted`, `text-2xs`.
- On a phone, Web shows the list view (cards on a tinted panel, every card naming its status); the view had no narrow layout.

After: Web's columns and cards from 640px; below that, Web's phone list. Inline shows three cards per column, or five in the list, then "N more". Full screen shows every card.

Not copied: drag and drop, the board edge shortcuts, tags, sub-task progress, the comment count and the Soko Bot orb avatar (the orb is a generated image).

## Task detail

Web: `apps/web/src/app/(app)/tasks/components/task-detail-view.tsx`, `task-detail-header.tsx`, `task-title-heading.tsx`, `task-description.tsx`, `task-metadata.tsx`, `apps/web/src/components/markdown.tsx`.

Before:

- The description was raw text: `-` bullets, `##`, `**` and `<b>` all showed as typed. Web renders Markdown (GFM, single line breaks kept).
- The title was `text-base`. Web's is `text-xl leading-tight font-semibold tracking-tight`.
- Status, due date and workspace were joined in a `·` line. Web has a Properties section: rows `h-8 text-sm`, with the glyph in a 20px slot.
- The priority was missing.
- Sections had no titles. Web titles each section `text-muted-foreground text-xs font-medium` (Description, Properties).
- Timeline comments were raw text with no avatar. Web's activity shows the author's avatar and renders comments as Markdown.

After: identifier and status marker over a `text-xl` title, then Description (Markdown), Properties (priority, assignee, due date, workspace), the one Iris button and the Timeline.

Not copied: inline editing, the copy-identifier button, attachments and file chips, mentions, Mermaid and syntax highlighting.

## Browse agents — phase 2

Web: `apps/web/src/app/(app)/agents/components/marketplace.client.tsx`, `apps/web/src/components/agents/directory/agent-tile.tsx`, `agents-page-classes.ts`, `apps/web/src/components/agents/agent-icon.tsx`.

- The view is a sideways carousel of `w-64` cards. Web is a grid, `repeat(auto-fill, minmax(16rem, 1fr))`, `gap-2`, with a search field above.
- The card has no fill and no hover. Web uses `bg-background border rounded-lg`, `hover:bg-accent`, and a stretched name link.
- The agent mark is a round initials disc. Web shows a `size-10 rounded-lg border bg-card-background` square holding the agent icon, falling back to lucide `Bot`.
- The view shows a two-line name and a three-line purpose. Web shows a one-line name, a two-line purpose and a `text-xs` muted footer with the vendor and a `size=sm` bordered "Start task" button.
- The view shows the price and rating on the tile and puts a full-width "Hire" below. Web shows neither on the tile.
- Not copyable: remote agent icons and vendor logos.
- Plan: Web's grid and tile, the `Bot` square, a `text-xs` meta row with price and rating, and a small bordered "Hire" button with lucide chevrons.

## Hire form — phase 2

Web: `apps/web/src/components/job-input/job-inputs-form-builder.tsx`, `job-inputs-grouped-form.tsx`, `apps/web/src/components/ui/input.tsx`, `form.tsx`.

- Fields are `min-h-11` with an outline focus. Web's `Input` is `h-10 bg-transparent dark:bg-quinary` with `ring-2` focus.
- Choices use native `<select>`, checkboxes and radios. Web uses shadcn's `Select`, `Checkbox` and `RadioGroup`.
- Labels and descriptions: the view marks "optional" and uses `text-xs` descriptions with `gap-5`. Web writes "Name *" for required fields, uses `text-sm` descriptions and `space-y-6`.
- Groups: the view shows every `fieldset` at once. Web steps through them with tabs, Back and Next.
- Footer: the view has one bordered "Review". Web has Clear (`secondary`) and Submit with a ⌘↵ hint.
- Plan: match `Input`, restyle choices to Web's bordered `size-4` controls on `control-border`, Web's label and description sizes, a bordered `default` Review, Iris only on the final Hire, and the confirm summary on a card with the price as a muted badge.

## Job status and input — phase 2

Web: `apps/web/src/components/jobs/job-details/job-details-view.tsx`, `job-details-name.tsx`, `job-meta-details.tsx`, `outputs.tsx`, `provide-input.tsx`, `apps/web/src/components/jobs/job-status-badge.tsx`.

- Status: the view shows a bold word and a pulsing dot. Web shows `JobStatusBadge`: a bordered chip with the status marker.
- Title: the view's is `text-base`. Web's is `text-xl font-semibold`.
- Meta: the view uses a `dl` grid. Web uses `justify-between` rows with `tabular-nums` and hairlines.
- Result: the view shows plain pre-wrapped text. Web renders Markdown in a `bg-card-background border rounded-lg` card with an agent avatar.
- Outputs: the view lists names. Web shows file chips with glyphs.
- Input request: the same form differences as the hire form.
- Plan: port the job status badge, the `text-xl` title, card events with a `Bot` avatar, the shared `Markdown` for the result, chip outputs and row meta.

## Social posts — phase 2

Web: `apps/web/src/app/(app)/projects/components/social-posts/project-social-posts.tsx`, `social-post-status-badge.tsx`, `social-post-thread-badge.tsx`, `apps/web/src/components/social-post-provider-icon.tsx`.

- Rows: the view's are unbordered list items. Web's are cards, `bg-background border rounded-lg p-3`, with a hover border.
- Provider: the view writes the name in a `·` line. Web shows a `size-9 rounded-md border` square with the provider icon.
- Status: the view has none. Web shows the status badge (marker and word), a thread badge, the scheduled time and the account.
- Media: the view writes "has media". Web shows thumbnails; the view cannot load images, so a lucide `Image` glyph with a count is the stand-in.
- Actions: the view uses quiet text buttons, and its cancel confirm uses Iris. Web uses an `outline` Review with `Eye`, and the `destructive` variant to confirm.
- Plan: card rows, local provider SVGs, the status badge with Web's `--status-*` ink tokens, an outline Review, and a destructive confirm.

## Hello and the shell states — phase 2

Web: `apps/web/src/components/ui/skeleton.tsx`, `apps/web/src/components/common/empty-state.tsx`.

- Loading: three generic bars. Web's skeletons take the shape of the page.
- Empty and error: a left-aligned `text-base` title and body. Web's `EmptyState` is centred, `py-12`, with an icon disc, a `max-w-[44ch]` description and an action.
- Plan: an `EmptyState` with an icon disc (`Inbox`, `TriangleAlert`) and "Open in Sokosumi" where there is a link, and a skeleton per view shaped like its layout.
