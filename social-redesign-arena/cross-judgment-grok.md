# Cross-Judgment: Social Scheduling Redesign

**Judge**: Grok 4.7 (independent cross-judge)
**Date**: October 10, 2026
**Evidence**: `phase-a-audit.md`, `candidate-a-opus.md`, `candidate-b-grok.md`, plus the current social shell and performance surfaces those proposals would have to live beside (`SocialPageShell`, `WorkspaceCalendar` reuse, `social-performance-overview.tsx`, semantic tokens in `apps/web/src/app/globals.css`).

Scores use only decisions written in the candidate documents. A wireframe that names a behavior counts. A phase checklist that says “loading states” or “mobile calendar” without a behavior does not. Claims that a proposal “explicitly follows Sokosumi tokens” are not credited unless the proposal says so.

## Scale

| Score | Meaning |
| --- | --- |
| 5 | Every bullet of the criterion is specified, and no material gap remains |
| 4 | The criterion is met, with one material gap |
| 3 | The problem is addressed, with more than one material gap or a miss on a stated numeric target |
| 2 | The proposal conflicts with the criterion, or leaves it mostly unspecified |
| 1 | The proposal fails the criterion |

The audit’s “50 points” line does not match the rubric. Six criteria at weights 2, 2, 1.5, 1.5, 1, and 1 sum to 9. Maximum is \(9 \times 5 = 45\).

Click counts below start from `/social`, already in the product. Typing is not a click. Each control activation is a click. An external OAuth consent screen is noted and not charged against the in-app budget.

---

## Criterion 1: Task Clarity and Hierarchy (Weight: 2x, Max: 10 points)

**Candidate A Score: 4/5**

- The header keeps the three jobs on screen: `Schedule View`, `+ New Post`, and `[@] Accounts`. The calendar is the page, so “see what’s going out” does not require choosing a mode first.
- The schedule dropdown replaces the six overlapping tabs with one mental model: one calendar, filtered to All, Drafts, Scheduled, Published, or Needs Attention. Renaming Queue to Scheduled removes the audit’s ambiguous status.
- Hierarchy inside creation is explicit: Write, then Platforms, then Schedule, with Back on later steps and the ability to jump back.
- The three panels are peers. Nothing on the default frame says which region to use first, and the middle column is both “post details” and “editor,” so viewing and composing share a slot whose empty, selected, and drafting states are not drawn.
- Connect is an icon plus an empty state. It is not labeled as a peer of New Post. The no-accounts empty state does name Connect Twitter, Connect LinkedIn, and Connect Instagram, which is the right first action when that state is showing.
- Step 3 offers a “Save as draft” radio and a separate Save Draft button. Two controls for one outcome weakens an otherwise clear schedule-versus-draft distinction.

**Candidate B Score: 4/5**

- The landing question “What do you want to do?” maps onto labeled cards: Create New Post, View Schedule, and Fix Failed Posts with a count. That is the clearest statement of the jobs in either proposal. Recent activity adds Continue editing for a draft without a status tab.
- Accounts stay on a header icon. The panel behind it is well specified (connected, expired, absent), and the icon can carry a problem badge, but connect is still not a labeled peer of create and view.
- The fourth card, Review Performance, is the same visual weight as the scheduling jobs. The audit excludes the performance tab and assigns it to other work. A primary card for that destination splits the hierarchy the hub is trying to clarify.
- Drafts are specified in three places (activity row, composer banner, calendar “Pin to calendar”). Each place is actionable. None is the source of truth, so “where do drafts live?” stays open.
- After a card click, the document switches to a separate composer, calendar, or recovery wizard. The persistent hierarchy of those destinations is thinner than the hub itself.
- The ready/help toggle is preselected to “I’m ready to go,” so it does not block the first task. It does add a second mode the user has to understand.

**Winner: Tie**
**Weighted Scores: A=8, B=8**

Tiebreaker, if a single criterion winner were required: neither. B is clearer in the first five seconds. A is the clearer ongoing structure, because posts have one home and a filter rather than a launcher plus scattered draft surfaces. The performance card stops B at 4. The equal-weight panels and the icon-only accounts entry stop A at 4.

---

## Criterion 2: Fewest Steps for Core Jobs (Weight: 2x, Max: 10 points)

Targets from the audit: connect ≤ 3 in-app clicks, create and schedule ≤ 5, view schedule ≤ 2, retry a failed post ≤ 2.

**Candidate A Score: 3/5**

| Job | Path specified | Clicks | Target |
| --- | --- | --- | --- |
| Connect | Accounts icon, then a provider. Empty state can be one Connect Twitter button. OAuth stays a popup, with status wrapped around it. | 1–2 in-app | Met |
| Create and schedule | New Post, Next: Platforms, Next: Schedule. Step 3 draws three empty radios, so the user must choose. Schedule-for-later then opens a date control and a time control, then Schedule. | 7 on the schedule path (6 if New Post is skipped because the editor is already mounted). Publish-now is 5 if platforms stay prechecked. | Missed for scheduling |
| View schedule | Calendar is the default left panel. | 0 | Met |
| Retry failed | Schedule View, Needs Attention, the post, then Reconnect, Edit, or Delete. There is no Retry control. | 4 from the default view; 2 only if the failed post is already visible and Reconnect counts as the retry | Missed |

- Platforms on step 2 are partly prechecked (Twitter and LinkedIn on, Instagram off with an image warning). That saves clicks. The stepper then spends them on two Next actions, and the schedule step has no default time mode.
- View-schedule at zero clicks is the best result in either proposal.
- Bulk reschedule, an audit gap, is absent. Duplicate-post is absent. Published posts are a filter, which is a short path and is specified.

**Candidate B Score: 4/5**

| Job | Path specified | Clicks | Target |
| --- | --- | --- | --- |
| Connect | Accounts icon, then Connect or Reconnect Now on the row. Add Account is the same panel. | 2 in-app | Met |
| Create and schedule | Start on the Create card. Post-to-all and Now are already selected, so publish is Start, then Post. Later is one radio plus the schedule control, then Post / Schedule. | 2 for publish now; 4–5 for later if date and time live in one control | Met |
| View schedule | Open on the View Schedule card. The calendar is not the default page. | 1 | Met |
| Retry failed | Fix Now, choose “Reconnect and retry” (or edit, or delete), then Fix & Continue. Skip moves to the next failure. | 3 for the first post | Missed |

- The single composer is why the schedule target is reachable. Defaults do the platform and timing decisions, and the ready/help toggle is already on Ready.
- The recovery wizard is one click from the hub and can bulk-apply one fix (reconnect Twitter for every failed post). That is the shortest multi-failure path in either proposal. It still misses the two-click target for a single retry, because the wizard asks for a choice and a confirm.
- Core job 6, “view published posts,” has no destination. Recent activity shows the latest post. Review Performance is stats, and the audit keeps that surface out of this redesign. Draft recovery is the opposite: Continue editing on the activity row is one click, and the composer offers Load draft.
- First-run order is weaker than A. The welcome state says “Let’s post your first message,” while the composer assumes “all connected accounts (3).” A user with zero accounts is not shown a connect-first path except by leaving to the accounts icon.

**Winner: B**
**Weighted Scores: A=6, B=8**

B hits three of the four numeric targets, including the primary create-and-schedule job. A hits connect and view, and the stepped composer misses the schedule budget before the date picker is counted generously. Neither proposal gives a two-click retry.

---

## Criterion 3: Honest States (Weight: 1.5x, Max: 7.5 points)

**Candidate A Score: 4/5**

- The connection wait is the most honest in-flight state in either document: “Opening Twitter authorization…”, a 1-of-3 progress mark, copy that the popup is where authorization happens, and Cancel. Success names the account and the permissions granted (post to timeline, read engagement). That answers the audit’s silent-OAuth failure directly, and the risk note keeps the Composio popup intact.
- Failure copy names a cause (“Twitter connection expired”) and a numbered repair (reconnect, review, publish again), with Reconnect, Edit, and Delete. The Needs Attention empty state lists different causes per post: expired connection, rate limit, media too large.
- Empty states for no accounts and a clear calendar each offer the next action.
- Post status is not drawn on items in the All Posts calendar. Status is mostly which filter is active, so a mixed calendar can hide draft versus scheduled versus published. The current product already has a status badge; this proposal does not say it stays on every item.
- Disconnect is a button with no consequence. The audit called that out. A lingering Pending connection, as opposed to the live wait, is not explained.
- Page-level loading and a failed save or schedule are not designed. “Loading states” and “Error boundaries” appear as phase-5 checklist items.

**Candidate B Score: 4/5**

- Durable connection status is explicit and always available from the header badge: connected, expired with Reconnect Now and last-post time, or not connected with Connect. Last-post time gives the user a clue when a token died.
- Failure recovery shows the reason, a preview of the actual post, and three remedies. The queue position (“Post 1 of 3”) sets expectations. Inline validation is equally concrete: Instagram with no media offers Add media or Uncheck Instagram, before submit.
- Draft honesty is stronger than A: silent save about every 10 seconds, “Last saved 2 seconds ago,” crash recovery, and a conflict dialog called out in risks. Empty states differ for “all caught up” and “first post ever.” Empty days on the calendar make a gap in the week visible.
- The in-flight OAuth wait is not designed. The panel shows end states. The audit’s critical failure is a popup that fails or sits pending with no explanation. A component named InlineConnectionWizard is listed; no authorizing, denied, or popup-blocked screen is drawn.
- “Recipients will see this… peak engagement / low engagement” and “Optimize for timezone” assert audience facts the scheduling documents do not tie to a data source. The performance work is explicitly out of scope. Showing peak and low engagement as if it were known is a less honest state than omitting it.
- The calendar uses the same post glyph for a scheduled item and for the drafts bucket, while failures get a distinct warning badge. Status is mostly visible in the activity feed (posted, draft saved, scheduled) and only partly visible on the grid.
- No skeleton or in-progress publish state is specified.

**Winner: Tie**
**Weighted Scores: A=6, B=6**

A covers the opaque moment (the OAuth wait) and specific failure causes. B covers the lasting account record, inline validation, and draft-save state, and it risks inventing engagement facts. Loading skeletons are unspecified on both sides, so neither reaches 5. A forced call would go to B for covering more of the four rubric bullets; A’s OAuth wait is the better answer to the higher-severity audit item, which keeps the scores level.

---

## Criterion 4: Design System Consistency (Weight: 1.5x, Max: 7.5 points)

The rubric asks for semantic tokens from `globals.css`, the spacing and type scale, consistency with the performance tab, and Radix/Shadcn patterns. Product UI in this repo cannot use raw palette colors, opacity-modified color utilities, or off-scale type. The performance surface already on this branch is a report: labeled selects, tables, sparklines, and `PostingConsistency`.

**Candidate A Score: 3/5**

- The proposal never names tokens, the type scale, spacing, dark mode, or a Shadcn primitive. That alone caps the score. Nothing in the wireframes contradicts the token rules either.
- Structure matches existing seams. `WorkspaceCalendar` stays and is enhanced. The schedule picker is called out as already present. Platform previews are extracted from `social-post-preview.tsx`. URL state stays in the query string (`view`, `editing`), which matches the app’s `nuqs` convention. Header actions, a dropdown, and a connection dialog are ordinary Button, Select/DropdownMenu, and Dialog shapes.
- The three-panel frame is new. It does not resemble the performance report, so “consistent with the performance tab” is unmet. It also does not invent a second statistics surface inside scheduling.
- Emoji in the wireframes read as sketch marks. The product uses Lucide icons. This is not charged as a shipped icon choice.

**Candidate B Score: 2/5**

- The same token, type, and spacing silence applies.
- Several pieces map to existing primitives: cards, a radio group, badges, a slide-over panel, and a bottom sheet. The calendar wrapper still starts from `WorkspaceCalendar`, which respects “improve, do not rewrite.”
- The proposal then puts performance inside scheduling: a Review Performance card, “View full stats,” “View Stats,” and a weekly “Posting consistency” line with its own tracker component. `PostingConsistency` already lives on the performance overview. A second consistency score, plus a card into a tab this redesign is not allowed to own, fights the consistency bullet rather than leaving it unspecified.
- The task-card launcher is a new page type. The current social page is a shell plus tabs over a calendar and lists. A hub of four equal cards is a different product shape, and the document does not say which existing layout, card, or section pattern it extends.

**Winner: A**
**Weighted Scores: A=4.5, B=3**

Both proposals are pre-visual, so neither can score 4 or 5 on a criterion whose first bullet is the token system. A stays inside the calendar and composer seams. B adds a parallel performance entry on a page the audit told this work not to redesign.

---

## Criterion 5: Accessibility (Weight: 1x, Max: 5 points)

**Candidate A Score: 4/5**

- Keyboard, name, and focus are specified against the actual layout. Tab moves through composer steps. Arrow keys move in the calendar. Enter selects a date or platform. Escape closes a panel and leaves the composer open, which is the right behavior for a multi-region page.
- Panels get accessible names. A live region announces post-status changes. Preview cards announce character counts. Connection progress is announced.
- Focus moves are concrete: opening the composer focuses the text editor, finishing a step focuses the next step’s heading, and closing returns focus to the trigger.
- Contrast is not addressed. WCAG 2.1 AA is a rubric bullet, and the wireframes never identify text, status, or warning pairs against the semantic ramps.
- Drag-to-reschedule has no keyboard equivalent. Skip links between the three panels are not specified, so a screen-reader user gets three named regions and no described way to jump among them. The mobile preview carousel is swipe-only in the mobile section.

**Candidate B Score: 3/5**

- Task cards are reachable with arrow keys and announce their counts (“Fix Failed Posts, 3 items”). The calendar announces the date and the post count. Connection status is announced, including “Instagram, connection expired.”
- Focus is right in two places: the composer opens on the text editor, and fixing one failed post moves focus to the next. Escape closes panels and does not discard wizard progress. Saving a draft confirms and returns focus to the trigger.
- The screen-reader line “Wizard announces step progress (Step 2 of 3)” does not match the composer, which is one screen with a ready/help toggle, not three steps. The failure UI is “Post 1 of 3,” a queue, not a step indicator. An accessibility plan that names a control the layout does not have is weaker than a shorter plan that matches.
- The same contrast gap and the same drag-without-a-keyboard-alternative gap apply. The bottom sheet’s focus trap, the expanded-sheet heading order, and a non-swipe way to expand it are not specified. Bulk selection has no keyboard model.

**Winner: A**
**Weighted Scores: A=4, B=3**

A’s accessibility section describes the three panels, the stepper, the character counts, and the connection wait that A actually draws. B’s section describes a stepped wizard the composer does not use, and it leaves the sheet and the drag gesture unspecified. Neither proposal states a contrast strategy, so neither scores 5.

---

## Criterion 6: Mobile Experience (Weight: 1x, Max: 5 points)

The rubric requires a real 375px layout, touch targets at least 44px, a reflow rather than a squeezed desktop, and the critical jobs available on the phone. Default controls in this app are `h-10` (40px), so a proposal that cares about the 44px rule has to say so. Neither does.

**Candidate A Score: 4/5**

- Below 768px the three columns become one column. Editor and Preview are tabs. The calendar moves to a floating button. The composer becomes a full-screen sheet. Previews become a swipeable carousel. That is a designed reflow of the whole page, and it covers 375px because 375 is inside the stated breakpoint.
- Create, preview, and schedule remain available. The calendar costs an extra tap via the floating button, which is acceptable under “critical features available.”
- The phone header still lists a schedule dropdown, New Post, and Accounts. Overflow at 375px is not handled. Touch-target size is not stated. The three-step footer (Back, Next, and the step body) will be tall on a phone, and the proposal does not say what collapses.
- Putting mobile in phase 5 does not erase the layout section above it. The layout is specified. The 44px rule is the remaining material gap.

**Candidate B Score: 3/5**

- The composer sheet is the better phone control in either document. A collapsed sheet shows the editor, the platform checks, Save Draft, and Post, with those actions at the bottom of the thumb zone. Swipe up reveals media, platforms, and the schedule picker. That is a mobile layout for composing, not a desktop form narrowed until it fits.
- The rest of the product is a phase-5 list: mobile calendar, touch gestures, responsive task cards. No 375px layout is drawn for the hub, the calendar, the connection panel, or the recovery wizard. Those are four of the six core jobs.
- Scheduling on the phone is behind the swipe-up. The collapsed sheet can publish “now” and cannot show the date picker until the sheet grows, and no labeled control is drawn for users who do not swipe.
- Touch targets are not sized. “Naturally responsive” task cards are asserted and not shown.

**Winner: A**
**Weighted Scores: A=4, B=3**

A specifies a small-screen version of every region it introduces. B specifies a stronger composer and leaves the hub, calendar, accounts, and recovery undesigned. The missing 44px spec keeps A at 4.

---

## Final scores

| Candidate | Raw (out of 30) | Weighted (out of 45) |
| --- | --- | --- |
| A, three-panel layout | 4+3+4+3+4+4 = 22 | **32.5** |
| B, task-centric hub | 4+4+4+2+3+3 = 20 | **31.0** |

**Overall winner: Candidate A, by 1.5 points.**

### Criterion summary

| Criterion | Weight | A | B | Weighted A | Weighted B | Winner |
| --- | --- | --- | --- | --- | --- | --- |
| Task clarity and hierarchy | 2 | 4 | 4 | 8 | 8 | Tie |
| Fewest steps for core jobs | 2 | 3 | 4 | 6 | 8 | B |
| Honest states | 1.5 | 4 | 4 | 6 | 6 | Tie |
| Design system consistency | 1.5 | 3 | 2 | 4.5 | 3 | A |
| Accessibility | 1 | 4 | 3 | 4 | 3 | A |
| Mobile experience | 1 | 4 | 3 | 4 | 3 | A |
| **Total** | | **22/30** | **20/30** | **32.5/45** | **31.0/45** | **A** |

A wins three criteria, B wins one, two criteria tie. The points gap is small because B wins the criterion with the largest practical payoff.

### Why A wins, and what the margin means

A is the more complete specification of a single work surface. The calendar stays visible (zero clicks to see the schedule), the OAuth wait is explained without replacing Composio, the accessibility notes match the panels that are actually drawn, and the phone layout refits every region. It also stays on the existing calendar and schedule-picker seams and does not open a second performance product inside scheduling.

B is the better model of the primary job. Post-to-all, publish-now, one screen, and a Fix card with a real reason and a preview will produce fewer clicks than A’s stepper. That advantage is worth two weighted points and is the strongest idea in the arena. It does not cover published history, it misses the two-click retry by requiring a choice plus confirm, its screen-reader script describes a wizard the composer does not have, and its phone layouts stop at the composer. The performance card and the in-calendar consistency score conflict with the performance tab this work was told not to absorb.

The 1.5-point margin is one raw point on design-system consistency, plus one raw point each on accessibility and mobile, minus B’s two-point lead on steps. It is not a mandate to build the stepper as drawn.

### Sensitivity

These three revisions would change the winner:

- Treat the performance card as already priced into the hierarchy tie, and score B’s design-system fit a 3. Totals become 32.5 to 32.5.
- Draw B’s hub, calendar, accounts panel, and recovery wizard at 375px with 44px targets. Mobile can move to 4, and B ties or passes.
- Collapse A’s composer onto one screen with B’s defaults (all connected accounts, Now selected, Save Draft distinct from Schedule). A’s steps score can move to 4, and A’s lead grows.

### Graft, if one base is implemented

Use A as the page: persistent calendar, schedule filter, accounts in the header, live platform preview, connection progress around the existing popup.

Use B inside that page:

- One composer surface with post-to-all and Now already selected, so scheduling does not cost two Next clicks.
- Failure recovery that shows the reason, the post preview, and a bulk fix when several posts share one broken account.
- Drafts as a continue action on recent activity, plus an autosave line.
- The phone composer as a bottom sheet with Post and Save Draft in the thumb zone, instead of a three-step footer.

Leave Review Performance, the weekly consistency score, and timezone “peak engagement” out of this slice. They belong with the performance tab, and they are not backed by a scheduling state in either proposal.
