# CMO.XYZ design system

The visual system for app.cmo.xyz: **corporate neobrutalism** on the Masumi palette. Masumi brings the calm (neutrals, Inter, one pink); Cuso brings the outline (a visible 1px ink line and one hard shadow). It should read like a serious tool with a friendly face.

- **Voice, product, agent naming:** [`DESIGN.md`](DESIGN.md). This file covers how things look.
- **Source:** the concept canvas https://claude.ai/artifact/9mWPtBgNY9HQ8wLXcadZk4 (boards Vibe, Site, Reading, Brand, Plan, Launch, Home, each with a dark version). Where a board and this file disagree, this file wins; Plan, Launch and Home on the canvas still use the earlier "Cuso Pop" radii, pills and 2px borders, which this file replaces.
- **Family:** colours follow the [Masumi Family brand guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide). CMO is its own product: never Sokosumi chrome, names or wording.
- **Tokens:** values live once, as CSS custom properties in `src/app/globals.css`. Components read tokens, never literals. `src/design-guards.test.ts` enforces the rules below; `src/components/phone-feeds.css` and `showcases.css` are exempt because they draw the networks' own UIs.
- **Preview:** `/design-system` (local and preview deploys) renders the tokens and components in both themes. The onboarding parts (step markers, checklist, question card, tile, side panel, assumption chip, goal block, stat row, avatar sizes) sit under Components, and `/design-system/onboarding/{hire,reading,writing,asking,brand,plan,planning,launch,launch-connected}` renders each real screen over fixture data (`?theme=dark` pins the theme).

## Five rules

1. **Lines do the work.** A 1px ink line on what you act on (cards with actions, inputs, buttons). A hairline for structure (header rule, dividers, inactive markers).
2. **One hard shadow.** 3px offset, no blur. Only the primary action and the one focused card on a screen carry it.
3. **Iris means now.** The current step and the next action. Never decoration, never text, never a thin mark. Text on Iris is always Neutral 950.
4. **Bold speaks, Regular works.** One Inter ExtraBold H1 per screen. Light for big numbers and statements, Regular for UI, Medium for labels, SemiBold for section heads.
5. **Three layers.** White page, gray panel, outlined white cards. A card sits on a panel, never straight on the page.

## Colour

| Token                  | Role                            | Light               | Dark                |
| ---------------------- | ------------------------------- | ------------------- | ------------------- |
| `--background`         | page                            | `#FFFFFF`           | `#0C0C0C`           |
| `--surface`            | panel (gray layer, sidebar)     | `#F5F5F5`           | `#171717`           |
| `--card`               | card on a panel                 | `#FFFFFF`           | `#0C0C0C`           |
| `--foreground`         | text                            | `#171717`           | `#FAFAFA`           |
| `--muted`              | secondary text                  | `#525252`           | `#A3A3A3`           |
| `--line`               | ink line on controls and cards  | `#0C0C0C`           | `#A3A3A3`           |
| `--border`             | hairline                        | `#E5E5E5`           | `#262626`           |
| `--primary`            | Iris Flower                     | `#FF51FF`           | `#D141D1`           |
| `--primary-hover`      | Iris on hover                   | `#FF51FF`           | `#FF51FF`           |
| `--primary-foreground` | text on Iris, green, yellow     | `#0C0C0C`           | `#0C0C0C`           |
| `--peach`              | Peach Blossom, behind Cuso only | `#FFC8F0`           | `#FFC8F0`           |
| `--ok`                 | done                            | `#00D43B`           | `#00D43B`           |
| `--warn`               | needs an answer                 | `#FFD300`           | `#FFD300`           |
| `--shadow-hard`        | the one hard shadow             | `3px 3px 0 #0C0C0C` | `3px 3px 0 #FAFAFA` |
| `--shadow-iris`        | selected tile's hard shadow     | `3px 3px 0 Iris`    | `3px 3px 0 Iris`    |
| `--stage`              | Cuso's avatar circle            | `#F5F5F5`           | `#F5F5F5`           |
| `--scrim`              | behind a modal sheet only       | black at 30%        | black at 30%        |

- **One pink per view.** Iris on the primary button and the current step. Peach appears only behind Cuso, never next to an Iris surface.
- **Dark Iris rests at `#D141D1`** and goes to `#FF51FF` on hover (approved for CMO 2026-11-04; the Masumi guide still says Iris is the same in both themes).
- **Green, yellow and Iris are fills only**, under a Neutral 950 glyph. On white they measure 1.4 to 2.7:1, so they never carry text or a thin mark.
- **Channel marks** keep their networks' colours (`--mark-*`); they are logos, not palette.
- No gradients, no glow, no blur, no transparency washes. The scrim behind a modal sheet is the one see-through colour.

## Type

Inter, through `--font-sans`. Numbers that compare use `font-variant-numeric: tabular-nums`.

| Step      | Size / line | Weight     | Tracking | Use                                  |
| --------- | ----------- | ---------- | -------- | ------------------------------------ |
| display   | 72 / 68     | 800        | -0.045em | Site hero only                       |
| h1        | 36 / 38     | 800        | -0.035em | the one screen title                 |
| statement | 28 / 32     | 300        | -0.01em  | a promise, the plan goal             |
| value     | 24 / 28     | 300        | -0.005em | tile values, big numbers, a question |
| h2        | 16 / 20     | 600        | 0        | card and panel heads                 |
| body      | 14 / 18     | 400        | 0        | UI text; 500 for labels and buttons  |
| small     | 12 / 16     | 400 or 500 | 0        | meta, field help, step markers       |
| micro     | 11 / 14     | 400 or 500 | 0        | sources, tags                        |

Inputs use 16px text so iOS does not zoom. Sizes are rem in code.

## Shape and space

- **Radius:** 6px small marks (checkboxes, tags, badges), 8px controls (buttons, inputs, step markers, chips, tabs), 10px cards, 14px panels. Fully round only for avatars and status dots.
- **Space:** a 4px grid. Page padding 32px (16px under 768px). Panel padding and gap 12px. Card padding 16, 20 or 24px. Sections stack 24 to 48px apart.
- **Width:** onboarding content max 1280px, Brand 1376px, Home main column 1120px. Panels fill their column; no centred narrow column except Launch (760px, one form).
- **Breakpoints:** layouts are `flex-wrap` with min widths, so they reflow without media queries. Under 768px everything is one column and the side panel becomes a bottom sheet.

## Elevation and motion

- Flat by default. The hard shadow is the only elevation; at most two per screen (the primary button and the focused card). The Site hero's tilted labels are the one exception.
- An inset 1px hairline (`inset 0 0 0 1px`) is a line, not a shadow, and is allowed where a border would shift layout.
- **Pressed:** the shadowed element moves 3px right and down and drops its shadow, as if pushed flat.
- Transitions are 150ms on colour and transform only, off under `prefers-reduced-motion`.

## Components

**Logo.** The CMO.XYZ wordmark from the concept canvas (`src/components/logo.tsx`), drawn in the text colour: ink on a light page, white on a dark one. 16px high in a header, never recoloured or set in Iris. Cuso's pointer mark stays the favicon and app icon.

**Header (onboarding).** Logo 16px high left, step markers centre, the site chip right (green 8px dot with a line edge, then the domain). Hairline below, 14px 32px padding.

**Step marker.** 8px radius, small 500, "1 Site". Current: Iris fill, ink line, `aria-current="step"`. Done: check icon, ink line, text colour. Not yet: hairline, muted text. Four steps: Site, Brand, Plan, Launch.

**Buttons.** 44px high, 8px radius, body 500, 0 18px.

- Primary: Iris fill, ink line, Neutral 950 text, hard shadow, trailing arrow. One per screen; its label is the screen's question ("Start reading", "Looks like us", "Approve plan", "Launch {agent}").
- Secondary: card fill, ink line, no shadow.
- Small: 32px high, 12px text; hairline edge by default, ink fill with inverted text when it is the selected item ("Open").
- Text: underlined muted 12px, 32px tap height ("Skip, decide on the plan").

**Input.** 44px, 8px radius, ink line, 16px text, card fill. Label above (body 500), help below (small, muted). Inputs keep the ink line so their edge passes 3:1.

**Selection.** Tabs, radio cards (pace) and the open tile button use the ink inversion: ink fill, inverted text. Iris is never selection; it means now.

**Card.** Card fill, ink line when it holds actions, hairline when it only shows, 10px radius. The focused card (the question card, the accounts list, Approvals) adds the hard shadow. A selected tile in a grid gets an Iris shadow instead.

**Tile.** Label (small 500, muted) with a small button right, value (value step), one line of detail (small), source (micro, muted, hairline above). Tap opens the side panel.

**Side panel.** A card beside the grid: h2 title, 32px close button with a hairline edge, short summary, hairline-separated list, source link, and a "Tell {agent} what's off" input.

**Question card.** Progress as five 6px segments (done: text fill; current: Iris with ink line; next: hairline). Topic (small, muted), question (value step), "Why I ask" line with an info icon, then Yes / No / Not sure as secondary buttons in three columns, and a text button to skip.

**Checklist.** 18px boxes, 6px radius. Done: green fill, ink line, check. Working: dashed ink line with a dot. Not yet: hairline.

**Skeleton.** Dashed hairline box with hairline bars. Never a shimmer.

**Assumption chip.** Sits on the line it changes (the budget, a move): panel fill, 8px radius, a 20px yellow disc with a Neutral 950 "!", the question, a small Yes button and a text alternative ("Change", "No").

**Goal block.** The plan's goal: an ink block with inverted text that inverts again in dark, 10px radius, statement step.

**Stat row.** Value step numbers over a small muted line, separated by a top line.

**Sidebar (CMO home).** Panel fill, hairline right, 232 to 260px. Workspace card on top, nav rows 40px with 8px radius, current row as a card with an ink line. Counts are ink badges, 6px radius, micro text. Cuso's status card sits at the bottom.

**Status.** Done: green disc, Neutral 950 check. Needs you: yellow disc, Neutral 950 "!". Failed or blocked: Neutral 950 disc, white X. Live: green dot with a line edge.

## Cuso

- **Cuso is the status.** Poses map to states: Reading, Thinking, Needs you (the only one labelled on Iris), Reporting, Done.
- **Avatar:** always on a `#F5F5F5` circle with a line edge and a little padding, in both themes, so his black outline reads in dark. 36px in rows, 48px beside a title, 72 to 96px in a hero card.
- **Stage:** the Site hero puts Cuso on an Iris stage with up to three tilted labels (8px radius, ink line, hard shadow, 15px 600). This is the one place labels tilt.
- **Celebration:** the party image shows only after Launch is pressed.
- **Name:** every string with the agent's name comes from the person's chosen name; build it in one string so no double space appears.

## Accessibility

- Text meets AA (Neutral 600 on white 7.8:1; Neutral 400 on Neutral 950 7.7:1; Neutral 950 on dark Iris 5:1).
- Focus: 2px solid `--foreground` outline, 2px offset. Iris is too light for a focus ring.
- Tap targets 44px; dense rows may use 32px with 8px between.
- Status is never colour alone: each disc carries its glyph and an accessible name.
- Every image has `alt`; decorative Cuso avatars use `alt=""`.

## Deliberate deviations from the Masumi guide

- Hard offset shadows (the guide asks for flat surfaces).
- Dark Iris at `#D141D1`.
- Inter replaces PP Mori, whose files were never delivered.

Raise these with the guide owner rather than drifting further.

Last updated: 2026-11-05
