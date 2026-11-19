# CMO.XYZ design system

The visual system for app.cmo.xyz: **neobrutalism** on the Masumi palette, the same look as the CMO.XYZ landing page. Masumi brings the palette (neutrals, PP Mori, one pink); Cuso brings the outline (thick ink lines and hard shadows). It should read like a serious tool with a loud, friendly face.

- **Voice, product, agent naming:** [`DESIGN.md`](DESIGN.md). This file covers how things look.
- **Source:** the concept canvas https://claude.ai/artifact/9mWPtBgNY9HQ8wLXcadZk4 (boards Vibe, Site, Reading, Brand, Plan, Launch, Home, each with a dark version). Since 2026-11-17 the app follows the landing page's look (thick lines, larger hard shadows, pills), which the canvas does not show. Where a board and this file disagree, this file wins.
- **Family:** colours follow the [Masumi Family brand guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide). CMO is its own product: never Sokosumi chrome, names or wording.
- **Tokens:** values live once, as CSS custom properties in `src/app/globals.css`. Components read tokens, never literals. `src/design-guards.test.ts` enforces the rules below; `src/components/phone-feeds.css` is exempt because it draws the networks' own UIs.
- **Preview:** `/design-system` (local and preview deploys) renders the tokens and components in both themes. The onboarding parts (step markers, checklist, question card, tile, side panel, assumption chip, goal block, avatar sizes) and the sidebar with Cuso's status card sit under Components; `/design-system/onboarding/<screen>` (hire, reading, writing, asking, brand, plan, planning, launch, launch-connected, subscribe, subscribe-confirming) and `/design-system/app/<view>` (chat, strategy, calendar, seo, results, competitors, brain, channels, settings; competitors also takes `?state=empty` and `?state=loading`) render each real screen over fixture data (`?theme=dark` pins the theme).

## Five rules

1. **One line does the work.** A 3px ink line on every outlined thing: cards, panels, frames (Cuso's picture too), inputs and full-size buttons. 2px on chips, tags, badges, small buttons and avatar circles. A 1px hairline only for structure inside a card: dividers, list rows, inner items. The landing page uses the same two widths.
2. **A hard shadow means you can act.** An offset with no blur, in two sizes and nothing above 6px. 4px under anything you can click, type in or pick: buttons, chips, inputs, the account card, the page you are on, and every one of a set to pick from (each tab, filter, pace and plan, picked or not). 6px only under the hire screen's button and the post that is open on the Calendar. What you cannot click has its line and no shadow, even when it needs the owner: every card and panel, Cuso's scene, report and message cards, tags, badges, labels, images (`design-guards.test.ts` holds this). The buttons inside a card carry the shadow.
3. **Iris means now, and picked.** The primary button, the current step, and the picked one of a set (the page in the sidebar, a tab, a filter, a pace, a plan). The fill alone says which one is picked: the others keep their shadow, so each still reads as a button. Never text, never a thin mark. Text on Iris is always Neutral 950.
4. **Bold speaks, Regular works.** One PP Mori SemiBold H1 per screen, tracked at -0.03em. Regular for statements, big numbers and UI, SemiBold for buttons, pills, labels that lead and section heads. Mori ships two cuts: weights 300 to 500 draw Regular, 600 to 800 draw SemiBold.
5. **Black strips for contrast.** White page, outlined panels and cards, and a black strip where the page needs weight: the action bar at the bottom of an onboarding step, a banner that needs the owner, the goal block. A strip inverts in dark.

## Colour

| Token                  | Role                                | Light            | Dark             |
| ---------------------- | ----------------------------------- | ---------------- | ---------------- |
| `--background`         | page                                | `#FFFFFF`        | `#0C0C0C`        |
| `--surface`            | panel (gray layer, sidebar)         | `#F5F5F5`        | `#171717`        |
| `--card`               | card on a panel                     | `#FFFFFF`        | `#0C0C0C`        |
| `--foreground`         | text                                | `#171717`        | `#FAFAFA`        |
| `--muted`              | secondary text                      | `#525252`        | `#A3A3A3`        |
| `--line`               | ink line and hard shadows           | `#0C0C0C`        | `#FAFAFA`        |
| `--border`             | hairline                            | `#E5E5E5`        | `#262626`        |
| `--primary`            | Iris Flower                         | `#FF51FF`        | `#D141D1`        |
| `--primary-hover`      | Iris on hover                       | `#FF51FF`        | `#FF51FF`        |
| `--primary-foreground` | text on Iris, green, yellow         | `#0C0C0C`        | `#0C0C0C`        |
| `--peach`              | Peach Blossom, behind Cuso only     | `#FFC8F0`        | `#FFC8F0`        |
| `--ok`                 | done                                | `#00D43B`        | `#00D43B`        |
| `--warn`               | needs an answer                     | `#FFD300`        | `#FFD300`        |
| `--shadow`             | anything you can click or type in   | `4px 4px 0` ink  | `4px 4px 0` ink  |
| `--shadow-big`         | the open Calendar post, hire button | `6px 6px 0` ink  | `6px 6px 0` ink  |
| `--shadow-iris`        | second button on a strip            | `4px 4px 0 Iris` | `4px 4px 0 Iris` |
| `--strip`              | the black strip                     | `#0C0C0C`        | `#FAFAFA`        |
| `--strip-foreground`   | text and lines on a strip           | `#FFFFFF`        | `#0C0C0C`        |
| `--stage`              | Cuso's avatar circle                | `#F5F5F5`        | `#F5F5F5`        |
| `--scrim`              | behind a modal sheet only           | black at 30%     | black at 30%     |

- **Iris is the one accent.** The primary button, the current step and the picked item. Peach appears only behind Cuso, never next to an Iris surface.
- **Dark Iris rests at `#D141D1`** and goes to `#FF51FF` on hover (approved for CMO 2026-11-04; the Masumi guide still says Iris is the same in both themes).
- **Green, yellow and Iris are fills only**, under a Neutral 950 glyph. On white they measure 1.4 to 2.7:1, so they never carry text or a thin mark.
- **Channel marks** keep their networks' colours (`--mark-*`); they are logos, not palette.
- No gradients, no glow, no blur, no transparency washes. The scrim behind a modal sheet is the one see-through colour.

## Type

PP Mori, through `--font-sans` (`mori-regular.woff2` and `mori-semibold.woff2` in `public/site/assets/fonts`, loaded in `src/app/layout.tsx`). The one other face on screen is content: the Brand Brain's "Your look" sets each of the brand's font names in that font where the device has it (`FontNames` in `brand-look.tsx`, the guard's one exception), and shows the brand's colours as discs, never as hex codes in a row. Numbers that compare use `font-variant-numeric: tabular-nums`.

| Step      | Size / line | Weight     | Tracking | Use                                  |
| --------- | ----------- | ---------- | -------- | ------------------------------------ |
| display   | 72 / 68     | 600        | -0.03em  | Site hero only                       |
| h1        | 36 / 38     | 600        | -0.03em  | the one screen title                 |
| statement | 28 / 32     | 300        | -0.01em  | a promise, the plan goal             |
| value     | 24 / 28     | 300        | -0.005em | tile values, big numbers, a question |
| h2        | 16 / 20     | 600        | 0        | card and panel heads                 |
| body      | 14 / 18     | 400        | 0        | UI text; 500 for labels, 600 buttons |
| small     | 12 / 16     | 400 or 500 | 0        | meta, field help, step markers       |
| micro     | 11 / 14     | 400 or 500 | 0        | sources, tags                        |

Inputs use 16px text so iOS does not zoom. Sizes are rem in code.

## Shape and space

- **Line:** `--line-width` 3px and `--line-width-small` 2px, and the 1px hairline inside a card. No other border width.
- **Radius:** one small scale, the same on the landing page: 8px small marks (checkboxes), 12px controls (buttons, inputs, nav rows), 20px cards, panels, sheets and Cuso's stage. `--radius-pill` (fully round) for tags, badges, step markers, tabs, filters, chips and the tilted labels. No 28px panel radius any more.
- **Space:** a 4px grid. Page padding 32px (16px under 768px). Panel padding and gap 12px. Card padding 16, 20 or 24px. Sections stack 24 to 48px apart.
- **Width:** onboarding is one centred column, 640px (the hire screen 820px for its headline); the open full plan widens to 1120px for its calendar. Every app page and the chat share one centred column, 880px; Strategy alone is wider for its funnel and calendar.
- **Breakpoints:** layouts are `flex-wrap` with min widths, so they reflow without media queries. Under 768px everything is one column and the side panel becomes a bottom sheet.

## Elevation and motion

- Hard shadows are the only elevation, in two sizes, and only on what you can act on. Every button, chip and input casts the 4px shadow, and so do the account card, the page you are on and every tab, filter, pace and plan of a set, picked or not. The 6px shadow marks the hire screen's button and the post that is open on the Calendar, which is a button. A post card on the Calendar takes the 4px shadow on hover. Every card that is not itself a button is flat, whatever it holds: the question card, the Launch accounts list, an approval waiting, a source or network not connected. Tags, badges, labels, pictures, Cuso's stage, sheets, report cards and info cards are flat too.
- An inset 1px hairline (`inset 0 0 0 1px`) is a line, not a shadow, and is allowed where a border would shift layout.
- **Pressed:** the shadowed element moves right and down by its own offset (4px, or 6px for the hire button) and drops its shadow, as if pushed flat.
- Transitions are 150ms on colour and transform only, off under `prefers-reduced-motion`. Onboarding adds three entrances, transform and opacity only: each piece of a step settles in after the one above it (450ms), a sheet rises from the bottom (400ms), and Cuso pops in.

## Components

**Logo.** The approved stacked-text lockup from the Masumi Family Brand Guide (`src/components/logo.tsx`, files in `public/logo/`): the mascot beside "CMO .XYZ" on two lines. The black file on a light page, the white one on a dark page; never recoloured, stretched or given effects. 46px tall in a header, which is 121px wide; a lockup with the mascot is never narrower than 120px. The favicon and app icon are the guide's Iris monogram.

**Header (onboarding).** Logo left, step markers centre, the site chip right (a pill: green 8px dot with a line edge, then the domain). A 3px ink line below, 14px 32px padding.

**Step marker.** One calm row, small 600, "1 Research". Only the current step is a pill: Iris fill, 2px ink line, `aria-current="step"`, flat as a label. Done and not yet are the same plain label with no line: a check and the text colour, or the number and muted text. A step that goes back to its screen is a link: its name underlined, a panel fill on hover, no line and no shadow, so it is never heavier than the step you are on. On a phone, where only the current step keeps its name, a step to go back to stands on the panel fill instead. Five steps: Research, Brand, Plan, Subscribe, Launch.

**Buttons.** 44px high, 12px radius, body 600, 0 18px.

- Primary: Iris fill, 3px ink line, Neutral 950 text, 4px hard shadow, trailing arrow. One per screen; its label is the screen's question ("Start reading", "Looks like us", "Approve plan", "Launch {agent}"). On the hire screen it takes the 6px shadow.
- Secondary: card fill, 3px ink line, 4px hard shadow.
- Small: 32px high, 12px text, 2px ink line, 4px shadow; Iris fill when it is the picked item ("Open").
- Text: underlined muted 12px, 32px tap height ("Skip, decide on the plan").
- Disabled: flat, hairline colour, no shadow.
- On a strip: the line and shadow take the strip's text colour; a secondary button stands on an Iris shadow.

**Pill.** Chips, tabs and filters: fully round, 2px ink line, card fill, 12px 600 text, and the 4px shadow, because you click them. A tag is a label ("Big move", "Partly backed", a date, a kind): fully round, a flat panel fill with a hairline, 12px 500 text, no ink line and no shadow, so it never reads as a button. A count is an ink pill with inverted text. Where a post or campaign stands (Written, Scheduled, Running) is not a pill: small muted words beside a mark (`.state`), so it never reads as a button.

**Input.** 44px, 12px radius, 3px ink line, 4px hard shadow, 16px text, card fill. Label above (body 500), help below (small, muted). The chat's composer is one input: one line and one shadow around its textarea.

**Selection.** Every one of a set to pick from is a button at rest: card fill, its ink line and the 4px shadow (tabs, filters, chips, the pace cards, the plan cards). The picked one is the same button filled with Iris under Neutral 950 text. Never a shadow on the picked one alone: a flat outline beside it reads as a label (`design-guards.test.ts`, "every choice reads as a button"). One that cannot be picked now is disabled: flat, hairline colour. The sidebar is a list of pages, not a set of buttons: its rows are plain and the page you are on takes Iris, the 2px line and the shadow.

**Plan card (Subscribe).** Under Cuso's scene and a card of what the approved month holds (checks: pieces and channels, pictures and videos, the daily and weekly work), the CMO plans of one interval as cards: a flat Iris "Fits your {pace} plan" mark on the one that fits, the tier's name, the price a month (value step; a yearly plan shows its month and "billed once a year"), credits a month (small). A Monthly / Yearly switch above them is a pair of pills, the picked one on Iris, and names the yearly saving; every plan card casts the 4px shadow and the picked one is filled with Iris. One primary button below names the plan and its price ("Start Growth for $500 a month") and leads to Polar's hosted checkout; a quiet row under it says only what is true (change or cancel in Settings, discount codes, Polar).

**Card.** Card fill, 3px ink line, 20px radius, flat. Only a card that is a button casts a shadow: the open Calendar post takes the 6px one (`button.card-focus`), and a tile to pick in a grid casts the 4px shadow, filled with Iris once picked. A panel (a section of an app page, a fold, a tab panel, a group of tiles) is the same line and radius.

**Funnel (Strategy).** One shape that narrows toward the sale, a slice a stage: each slice starts as wide as the one above ends, with a 3px ink line and a flat fill (card, Iris, yellow, and green for the last stage, the sale), and holds the stage's number, its classic name and what people do there in Neutral 950 (text colour on the card slice). The funnel is the one place Iris, yellow and green are fills for a picture and mean neither picked nor a status. Beside each slice, under it on a phone: the stage's goal (value step) and the same three answers at every stage, so they line up down the page: What Cuso does (one line a channel), What you do, and How we know it works (the number, today's value in the value step only when it is a figure of five words at most, a sentence as plain words, and a green disc when it is measured or "Cuso's estimate" when it is not). Nothing is pressed and nothing folds.

**Number.** A count to read (Results, SEO) is a small muted label over the value step, with no box: an outlined box reads as a field to type in.

**Post (Calendar sheet).** A social post as it will look on its network: a hairline card with the business's mark, name, handle and time, the network's mark at the right, the words, then the picture or video (Instagram: picture first). Flat. Under it, where the post stands (`.state`) on the left and "Edit text" (a small secondary button) on the right; editing swaps the words for an input and Save / Cancel.

**Tile.** A row in one outlined gray group, hairlines between: label (small 500, muted), value (16px 500, one line), one line of detail (small, muted), chevron right. Tap opens the row's sheet, which carries the source.

**Side panel.** A sheet that rises from the bottom of the screen, as wide as the column: h2 title, 32px close button with the small line and the 4px shadow, short summary, hairline-separated list, source link, and a "Tell {agent} what's off" input.

**Question card.** Progress as 10px pill segments with a 2px ink line (done: text fill; current: Iris; next: empty). Topic (small, muted), question (value step), "Why I ask" line with an info icon, then Yes / No / Not sure as secondary buttons in three columns, and a text button to skip.

**Checklist.** 20px boxes, 8px radius, 2px line. Done: green fill, ink line, check. Working: dashed ink line with a dot. Not yet: hairline colour.

**Skeleton.** Dashed hairline box with hairline bars. Never a shimmer.

**Assumption chip.** Sits on the line it changes (the budget, a move): panel fill, a 20px yellow disc with a Neutral 950 "!", the question, a small Yes button and a text alternative ("Change", "No").

**Goal block.** The plan's goal: an ink block with inverted text that inverts again in dark, 20px radius, statement step.

**Sidebar (CMO home).** Panel fill, a 3px ink line on its right, 232 to 260px. Workspace card on top, nav rows 40px with 12px radius, the current row on Iris with a 2px ink line and the 4px shadow. Counts are ink pills, micro text. Cuso's status sits at the bottom as one small row: his pose on a 56px Iris stage with the 2px line, his name, and one line that says what he is doing (with the running bar while he works). The pages keep the room.

**Strip.** A black band with white text that inverts in dark (`--strip`, `--strip-foreground`): the action bar at the bottom of an onboarding step and the banner that says Cuso is paused or out of credits.

**Working and "How I got here" (chat).** While Cuso works, his row shows the step he is on (body 500, beside the three working dots) and the model's latest reasoning under it (small, muted, two lines at most). Under a reply, "How I got here" is a fold: a muted small row with a chevron, opening to the steps and the reasoning behind a hairline on the left. Both are flat with no ink line: nothing here is pressed but the fold's row.

**Status.** Done: green disc, Neutral 950 check. Needs you: yellow disc, Neutral 950 "!". Failed or blocked: Neutral 950 disc, white X. Live: green dot with a line edge.

## Cuso

- **Cuso is the status.** He is drawn flat, black line on white, in five poses (walking, pointing, thinking, thumbs up, searching). Poses map to states: Reading (searching), Thinking (thinking), Needs you (pointing, the only one labelled on Iris), Reporting (walking), Done (thumbs up).
- **Avatar:** always on a `#F5F5F5` circle with a line edge and a little padding, in both themes, so his black outline reads in dark. 36px in rows, 48px beside a title, 72 to 96px in a hero card, 176px where he leads an onboarding step.
- **Cuso leads onboarding.** Every step opens with his pose on the hero's Iris stage (`CusoScene`, 220 by 280px): Research, Brand, Plan, Subscribe and Launch each have their own; a failure or a question shows the Needs you avatar instead. While he works, a tilted label over the stage's lower edge says what he is doing now (with the working dot) and an ink bar runs along the bottom, so the wait reads as work. The title under him is what he says. Below him sits the one thing to do; everything else folds into rows (`.ob-fold`) and sheets, and the step's action stays in a bar at the bottom of the screen (`.ob-bar`).
- **Stage:** Cuso's stage is a picture, so it is flat: a 3px ink line and 20px radius, in onboarding and in the sidebar alike. The hire hero adds up to three tilted labels (flat pills: 2px ink line, 16px 600); a step's scene carries one, what he is doing now. These are the only places labels tilt. In the sidebar his small stage turns into a button while he needs the owner (it opens the chat): then it takes the 4px shadow and his line stands on Iris.
- **Celebration:** the thumbs-up on an Iris card shows only after Launch is pressed.
- **Motion:** Cuso's poses are stills. On the hire screen the three labels pop in one after another (500ms, transform only, the one entrance longer than 150ms); while he works, the bar under his pose runs. Under `prefers-reduced-motion` nothing moves.
- **Name:** every string with the agent's name comes from the person's chosen name; build it in one string so no double space appears.

## Accessibility

- Text meets AA (Neutral 600 on white 7.8:1; Neutral 400 on Neutral 950 7.7:1; Neutral 950 on dark Iris 5:1).
- Focus: 2px solid `--foreground` outline, 2px offset. Iris is too light for a focus ring. A source chip inside a sentence draws it 4px inside its 32px tap area, so the ring hugs the words and not the lines around them.
- Tap targets 44px; dense rows may use 32px with 8px between.
- Status is never colour alone: each disc carries its glyph and an accessible name.
- Every image has `alt`; decorative Cuso avatars use `alt=""`.

## Deliberate deviations from the Masumi guide

- Thick ink lines and hard offset shadows (the guide asks for flat surfaces).
- Dark Iris at `#D141D1`.

Raise these with the guide owner rather than drifting further.

Last updated: 2026-11-18
