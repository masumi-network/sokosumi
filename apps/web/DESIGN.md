---
version: alpha
name: Sokosumi
description: >-
  Design system for Sokosumi — the AI-agent marketplace in the Sumi (AGENTIC)
  family alongside masumi (blockchain layer) and kodosumi (the code). Follows the
  Masumi Family Brand Guide (github.com/masumi-network/Masumi-Family-Brand-Guide):
  Iris Flower primary as a fill with Neutral 950 text, shared neutrals, Inter
  throughout, sentence case, segmented full-bleed lines, borders first. Chromatic
  accents beyond the primary come only from the shared Masumi palette. Tokens are CSS-first (Tailwind v4
  `@theme` in apps/web/src/app/globals.css); there is no tailwind.config. shadcn/ui
  (new-york, neutral base, lucide) over Radix.
  Color values live only in apps/web/src/app/globals.css — do not duplicate a hex table here.
typography:
  display:
    fontFamily: Inter
    fontWeight: 300
    fontSize: 30px
    lineHeight: 36px
    letterSpacing: -0.02em
  heading:
    fontFamily: Inter
    fontWeight: 600
    fontSize: 18px
    lineHeight: 28px
    letterSpacing: -0.025em
  subheading:
    fontFamily: Inter
    fontWeight: 600
    fontSize: 16px
    lineHeight: 24px
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 14px
    lineHeight: 20px
  label:
    fontFamily: Inter
    fontWeight: 500
    fontSize: 12px
    lineHeight: 16px
  caption:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 12px
    lineHeight: 16px
  micro:
    fontFamily: Inter
    fontWeight: 500
    fontSize: 11px
    lineHeight: 16px
rounded:
  xs: 2px      # Tailwind default (marks under 10px: tooltip arrow, confetti)
  sm: 6px      # --radius - 4px
  md: 8px      # --radius - 2px
  lg: 10px     # --radius (0.625rem)
  xl: 14px     # --radius + 4px
  2xl: 16px    # Tailwind default (used directly for cards/hero)
  full: 9999px
spacing:        # Tailwind default 4-pt scale (no custom spacing token)
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  12: 48px
components:
  button:
    backgroundColor: background
    textColor: foreground
    rounded: "{rounded.md}"
    height: h-10
    padding: 8px 16px
    typography: text-sm font-medium
  buttonHover:
    backgroundColor: accent
  buttonPrimary:
    backgroundColor: primary
    textColor: primary-foreground
  buttonPrimaryHover:
    backgroundColor: primary-hover
  buttonSm:
    height: h-8
    padding: 0 12px
  buttonIcon:
    size: size-10
  input:
    height: h-10
    rounded: "{rounded.md}"
    backgroundColor: transparent
  badge:
    rounded: "{rounded.md}"
    padding: 2px 8px
    typography: "{typography.label}"
  card:
    backgroundColor: card
    rounded: "{rounded.xl}"
    padding: 24px
  dialog:
    rounded: "{rounded.lg}"
    padding: 24px
  searchHero:
    backgroundColor: foreground
    textColor: background
    rounded: "{rounded.full}"
    height: 56px
  categoryChip:
    rounded: "{rounded.md}"
    padding: 2px 8px
    typography: "{typography.label}"
  focusRing:
    width: 2px
---

# Sokosumi — Design System

> Source of truth for tokens: **`apps/web/src/app/globals.css`** (Tailwind v4 `@theme inline` +
> `:root`/`.dark`). There is **no `tailwind.config.*`** — it's CSS-first. shadcn/ui is
> configured in `apps/web/components.json` (style `new-york`, base `neutral`, CSS variables,
> icon library `lucide`). Edit tokens in `globals.css`; reference them by semantic name.

## Overview

Sokosumi is the **AI-agent marketplace** in the **Sumi (AGENTIC)** family — alongside
**masumi** (blockchain layer) and **kodosumi** (the code). Voice: **sincere, minimal,
consistent** — heavy contrast, ample white space, restraint. Sokosumi is the **vessel**
where masumi and kodosumi meet. It follows the
[Masumi Family Brand Guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide):
**Iris Flower primary on the shared neutrals**, and everything else is simplified to gray so
the work stands out. Brand names and the first letter of any brand are always **lowercase**; UI copy is
**sentence case**.

- **Aesthetic:** intricate minimalism — Linear/Notion precision with a warm, human edge.
- **Color discipline:** neutrals carry the UI and Iris Flower is the one accent, as a fill;
  other palette colours appear **only when they communicate** (charts, status, category).
  One pink per view: never mix Iris with Electric Pink, Vivid Sakura or Peach Blossom.
- **Theming:** dark mode is a `.dark` class that re-defines the same token names; reference one
  token and theming is automatic. `--radius`, `--primary` and the solid category colours `--chart-1`…`4` are
  identical across modes; `--chart-5` is a neutral that steps with the theme, and every
  `-quinary` resting fill is retuned for dark.

## Colors

### Primary — Iris Flower, a fill

The primary is Iris Flower in light. Dark rests on **Dark Iris** `#D141D1` (Proposed,
off-guide): Iris Flower measures 7.3:1 on Neutral 950 against 2.7:1 on white, so it reads
about three times louder in dark. It is a **fill**: the label on it is always
`--primary-foreground` (Neutral 950; 7.33:1 on Iris Flower, 5:1 on Dark Iris). It is never
text, a border or a thin mark on the page, where it measures 2.67:1 on white.
`--primary-hover` is Iris Flower in both themes, so a dark primary lifts to full Iris on
hover and a light one keeps its fill.

There are no other primary aliases or tints: use `bg-primary`, and the neutral steps for tints.
Never invent a tint at the call site (`bg-primary/55`, `color-mix(…, transparent)`); if no
step fits, add one in `globals.css`.

### Neutrals

The guide's shared neutrals (White, Neutral 50 to 950, Black) behind the role ramp
(`--background` / `--card-background` through `--foreground`) and the step ramp
(`--secondary`, `--tertiary`, `--quaternary`, `--quinary`, `--senary`). Values live in
`globals.css`. Three steps leave the guide's role table to stay AA: light
`--muted-foreground` is Neutral 600 (Neutral 500 is 4.35:1 on the panel), `--input` is
Neutral 500 in both themes (the guide's field border is under 3:1), and dark
`--quaternary`/`--quinary` sit one step deeper so muted text clears 4.5:1 on them. Pages stack three surfaces (see **Page surfaces** under Layout):
white `--background`, the light-gray `--card-background` panel, and white components with a
`--border` hairline on top of it. Default border = `--border`; `--input` is a separate, stronger
boundary for fields (input, textarea, select, checkbox, radio). Labelled controls (outline
buttons, toggles, triggers, option cards) take the soft `--control-border`. The base layer applies `border-border` + `outline-ring` to all elements.

### Category palette (ecosystem)

Category accents come from the shared Masumi palette, mapped to `--chart-1…5` — **never**
stock shadcn chart defaults. Hex values live only in `globals.css`. Proposed until the
guide's data visualization rules (6.6) land.

- `--chart-1` — Iris Flower (both themes; the primary dims in dark, the chart does not)
- `--chart-2` — Persimmon
- `--chart-3` — Golden Yellow
- `--chart-4` — Sand
- `--chart-5` — Neutral 500 (light) / Neutral 400 (dark)

These are vivid (built for fills/ink, not small text). Use as **solid fills** (badges, mock
accents) or **`-quinary` resting fills** (chips — `--chart-N-quinary`); keep adjacent
text/icons **neutral** for contrast.

### Token families (reference)

Beyond the above, `globals.css` exposes:

- **Semantic:** `--semantic-destructive`, `--semantic-warning`, `--semantic-success`, each
  with a `-foreground`. Success (green) and warning (Golden Yellow) are **fills only**, 2.00
  and 1.44:1 on white, under their `-foreground` glyph; they are never text, an icon colour or
  an edge. Destructive is Neutral 950 (Neutral 50 in dark), so it can be text.
  `--semantic-destructive-solid` is the fill that carries a near-white label. There is no
  tint or label step: chips and tints take the neutral roles (`bg-muted`, `bg-quinary`,
  `border-border`, `text-foreground`). There is no info role: it was retired into
  `--status-working`.
- **Status:** `--status-working` (Iris, Dark Iris in dark, a fill only), `--status-external`, `--status-done`
  (neutral, no steps), `--presence-offline`, `--risk-high` (Golden Yellow, a fill only).
  `src-walk-guards.test.ts` fails on a fill-only status colour used as text or an edge.
- **Overlay:** `--overlay` (the Alpha 50 scrim behind a dialog),
  `--overlay-primary`, `--scrim`, `--scrim-soft`, `--scrim-strong` (alpha lives in the token, not
  at the call site). Floating chips and sticky headers are opaque: `bg-popover`, `bg-background`.
- **Media:** `--on-media` (text over images and video, with `--on-media-muted`, `--on-media-tertiary`, `--on-media-quaternary`),
  `--media-ground`.
- **Surfaces and states:** `--background-muted`, `--card-background-hover`,
  `--disabled-foreground`, `--scrollbar-thumb`, and `*-hover` steps
  for filled controls.
- The **sidebar-** set, the **social-** link colours, and
  `card/popover/border/input/ring`.

Use semantic tokens
(`bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring`) —
never hardcoded hex, never an opacity modifier on a colour utility.

## Typography

**Inter** is the entire system.

- **Inter Light (300)** — display only: the hero and a few page-level `h1`s
  (`text-2xl md:text-3xl font-light`).
- **Inter Semibold (600) / Medium (500)** — headings. Most `h1`–`h3` are `font-semibold` or
  `font-medium` with `tracking-tight`; small section headings sit at `text-sm`/`text-lg`.
- **Inter Regular (400)** — body & UI (the workhorse; base `text-sm`/14px).
- **Inter Medium (500)** — labels, badges, chips, callouts.
- **Scale:** pentatonic — base **12px**, ×2 every 5 steps (`r = 2^(1/5) ≈ 1.1487`); Light kicks
  in ~20px+, with **negative tracking** growing at large sizes. Stick to the Tailwind scale
  (`text-2xs/xs/sm/base/lg/xl/2xl/3xl/4xl`). No arbitrary `text-[…]` size in any unit: `text-[13px]`
  and `text-[0.8125rem]` are the same off-scale 13px, and the guard fails both.
- **`text-2xs` (11px, `micro`)** is the only step below `text-xs`, defined in `globals.css`. It
  is for dense meta and badges only: counts, chips, avatar initials, kbd hints, table meta.
  Never body copy or a label someone has to read to act.
- **Case:** **Sentence case** headlines — never all-caps. `uppercase` is for mono identifiers
  and key caps only.
- **Alignment:** prose and headings are left-aligned, or centered in empty states and heroes.
  Right-align numeric columns, trailing meta and row actions. Never justify.
- Headings (`h1`–`h4`) balance and paragraphs wrap pretty from the base layer in `globals.css`;
  don't repeat `text-balance` / `text-pretty` per element.

## Layout

- **CSS-first, no JS config.** Breakpoints are Tailwind defaults (`sm 640 · md 768 · lg 1024 ·
  xl 1280 · 2xl 1536`); **`md` is the primary mobile/desktop split** (sidebar hidden→flex,
  header sticky). `2xl` is effectively unused.
- **App shell:** sidebar + a sticky header, `<main data-app-main class="… p-4 …">`
  (overflow-y-auto). That `p-4` is the only horizontal gutter (see Shapes).
- **Container:** the custom `.container` (centered, capped at 1400px) is for marketing pages
  only. App pages fill the width (below).
- **Spacing:** Tailwind 4-pt scale (no custom token). Common: gaps `gap-2/3/4`, vertical rhythm
  `space-y-4/6`, top-level page sections `space-y-12`; tight inline groups `gap-1/1.5`.
- **Grid patterns:** marketplace companies are master-detail (a company rail beside a detail
  column, `md:grid-cols-[13.5rem_1fr]`); offer cards `sm:grid-cols-2 xl:grid-cols-3`;
  forms/content `sm:grid-cols-2`.
### Page surfaces

Every app page uses the same three layers. The Tasks board is the reference.

1. **Page:** white `bg-background`. Only the sidebar and the top bar differ.
2. **Panel:** `bg-card-background rounded-xl`, **no border**. Panels hold the page's main
   content: a board column, a list, a group of settings. Use `HOLDER_CLASS`
   (`components/ui/holder-surface.ts`), padding `p-2` (lists) or `p-3` (settings).
3. **Component:** white again, with a light-gray border: `HOLDER_ITEM_CLASS`
   (`bg-background rounded-lg border border-border`; hover `HOLDER_ITEM_HOVER_CLASS`) for
   list rows and Task cards, or the `Card` component (`bg-card rounded-xl border`) for a form
   or settings block.

Never put a component straight on the white page (white on white with only a border), and
never give a panel a border. A section label sits inside the panel, above its components, in
`text-muted-foreground text-xs font-medium`.

```tsx
// The pattern, as the Tasks board, Files, Schedules and Projects draw it.
<div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>   {/* layer 2: light gray, no border */}
  <h2 className="text-muted-foreground px-2 pt-1 text-xs font-medium">Yesterday</h2>
  <Link className={cn(HOLDER_ITEM_CLASS, HOLDER_ITEM_HOVER_CLASS, "px-4 py-3")}>
    {/* layer 3: white, bordered */}
  </Link>
</div>
```

### Fill the width

App pages use the full width of `main` (inside its one `p-4` gutter). No `mx-auto max-w-*`
page column, including on settings, catch-up and empty-data pages. Wide content gets more
columns, not more margin: lay settings and cards out in a grid (`md:grid-cols-2`,
`xl:grid-cols-3`). Limits that stay: dialogs and sheets have their own `max-w-*`, a paragraph
may cap its own line length (`max-w-prose`), and a centered **empty state** message is fine
inside a full-width panel.

- **Entry page:** the home (`/`) is the one page that is not a working surface. Like a chat
  app's start screen, it centers a `max-w-3xl` column: the bot, a greeting, the composer a
  little above the middle of the screen, prompt chips, then a quiet list with no panel or
  borders.
- **Full-bleed:** visuals/bands may break out. The marketplace hero uses `-mx-4 -mt-4` to escape
  page padding; the agent-detail route opts out of shell clipping through
  `body[data-agent-fullbleed="true"]`, which `AgentFullbleedEffect` toggles (`globals.css`).

## Elevation & Depth

Borders first (guide 5.5). No glow, no blur. Shadows stop at `shadow-lg`.

- Define regions with **hairline borders/rings** (`ring-1 ring-border`, `border-border`).
- **Shadows:** a small shadow (`shadow-sm`, `shadow-md`) may lift a card on hover;
  `shadow-lg` is the ceiling, for floating overlays only. `shadow-xl`,
  `shadow-2xl` and a hand-written `shadow-[…]` drop shadow are out under any variant; an
  arbitrary `shadow-[inset_…]` hairline is a border and stays. No shadow **token scale**
  exists — use Tailwind `shadow-*` defaults. Guard:
  `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts`.
- **Overlays use a scrim:** the dialog overlay is `bg-overlay`, nothing more. `backdrop-blur`
  and `blur-*` are out everywhere; the guard fails on them. A floating chip over content is
  `bg-popover border`, opaque.
- **Z-index:** no formal ladder. **`z-50` is the standard overlay layer** (dropdowns, popovers,
  modals); `z-10` for local stacking. Two surfaces sit above it on purpose: the mobile search
  takeover (`z-[60]`, over the `z-50` header) and the cookie banner (`z-[100]`, over every
  overlay). Nothing else goes above `z-50`; the guard holds that list.

## Shapes

- **Radius scale (off `--radius: 0.625rem` = 10px):** `sm 6 · md 8 · lg 10 · xl 14`; plus
  Tailwind defaults `xs 2` (marks under 10px: the tooltip arrow, confetti), `2xl 16`
  (cards/hero) and `full` (search pill, filter chips, avatars). Use
  `rounded-xs/sm/md/lg/xl/2xl/full` — don't hardcode a radius, in a class (`rounded-[4px]`) or a
  style object (`borderRadius: "0.5rem"`), in any unit. Keywords and tokens are fine
  (`rounded-[inherit]`, `var(--radius-lg)`). Guard:
  `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts`.
- **Segmented lines:** a thin line anchors content to the grid and acts as **separator** — used
  to define sections and delineate cards. In-app these are **full-bleed**
  (`-mx-4 border-t border-border`) between major blocks and company groups.
- **One gutter, one bleed.** The app has exactly one horizontal gutter: `p-4` on
  `main[data-app-main]`. A page must not add a second one, because a rule can only escape
  padding it knows about, and a rule that escapes 16px inside a page that adds another 16px
  still stops 16px short. So the bleed is always `-mx-4`, never `-mx-6`. `-mx-6` was the old
  habit, correct only on the two pages that added `px-2` of their own and 8px too wide
  everywhere else. `main` also sets `scrollbar-gutter: stable`: it is the scroll container, so
  without that the scrollbar takes its width out of the content box on the right only and
  every rule stops further from the right edge than the left. Guard:
  `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts`.
  App pages have no centred `max-w-*` column (see **Fill the width**), so every page shares
  this one gutter.
- Avatars are **circular** for people; square source art is shown **whole** (no crop).
- **Whole pixels:** every layout and border length is a whole number of CSS pixels. A 1x
  display, which is most Windows hardware, has no half pixel, so a `1.5px` border rounds to
  1px on one edge of a box and 2px on the opposite one, and a `0.2px` border rounds away to
  nothing. Shadow radii, keyframe translations and unitless scale factors are continuous and
  stay fractional. See [Whole pixels](../../.cursor/rules/whole-pixels.mdc).

## Components

shadcn/ui wrappers over Radix in `apps/web/src/components/ui/`; each carries a `data-slot`.
Variants via `class-variance-authority` (Button, Badge, Alert, Sidebar); others are
prop/state-driven.

- **Button** — 8 variants: `primary` (bg-primary), `default` (bordered, _default_),
  `destructive`, `outline`, `secondary` (bg-quinary), `ghost`, `link`, `muted`. 4 sizes:
  `default` (h-10 px-4), `sm` (h-8 px-3), `lg` (h-10 px-6), `icon` (size-10). Default control
  height is `h-10` (scales with root rem; Dynamic Type cap 1.25×). Base:
  `transition-[color,background-color,border-color,transform] duration-150 ease-out press
  disabled:opacity-50`, hover per-variant (`hover:bg-primary-hover` on `primary`, Iris Flower over Dark Iris in dark /
  `hover:bg-accent` on the bordered `default` / `hover:bg-quaternary`), embedded SVG defaults to `size-4`.
  Pass `loading` to the button whose request is running: it keeps the label and width and
  draws `ButtonLoadingBar`.
- **Input** — h-10, `rounded-md border-input bg-transparent`, `text-base md:text-sm`
  (via `withEditableTextSize`).
- **Badge** — 4 variants (default/secondary/destructive/outline), `px-2 py-0.5 text-xs
  font-medium rounded-md`, SVG `size-3`. A badge labels a state; it never answers the pointer.
- **Card** — `bg-card rounded-xl border py-6`, with Header/Title(`font-semibold`)/Description
  (`text-muted-foreground text-sm`)/Content/Footer; `px-6` insets.
- **Dialog** — centered, `max-w-[calc(100%-2rem)] sm:max-w-lg`, `rounded-lg border p-6`; overlay
  `bg-overlay`; built-in close button; open/close = fade + zoom-95.
- **Select / DropdownMenu / Tabs / Tooltip / Switch / Checkbox** — token-driven; states via
  Radix `data-[state=…]` + `focus-visible:border-ring`; tabs/list `bg-muted h-9
  rounded-lg`; tooltip `bg-secondary text-secondary-foreground text-xs` (neutral, never Iris).
- **Segmented controls** (ToggleGroup) — switch the view of the same content; Tabs move
  between panels and keep their own look. One look for every segmented control: a
  `bg-card-background rounded-lg p-1` track holds `h-8 rounded-md px-3` options in
  `text-muted-foreground` (`hover:text-foreground`); the selected option is a
  `bg-background text-foreground shadow-sm` pill inset in the track, `Highlight` under forced
  colours. The classes live in `components/ui/segmented-control-classes.ts` and ToggleGroup
  wears them by default, with no variants or sizes. Callers pass layout only (width, wrap,
  overflow, `size-10 px-0 md:size-8` for an icon-only option), never a fill, border, radius, shadow, text
  colour or `data-[state=on]:` class; `src-walk-guards.test.ts` holds that.
- **Marketplace components** (`components/agents/coworker-gallery-section.tsx`): full-bleed
  **hero search** (inverted `bg-foreground` / `text-background` `rounded-full` pill);
  **company rail + detail** (pick a company on the left, its coworkers and "Ready-to-run
  offers" on the right, capped with "Show all"); **coworker tile** (circular avatar + name +
  role + model/region tags); **offer card** (content-aware preview mock + category chip +
  output-type chip + coworker); **offer detail dialog** (`sm:max-w-5xl lg:max-w-6xl`, two
  columns at 86dvh on desktop, a 46dvh preview on mobile, real PDF/Office embed, multi-output
  tabs).

## Motion

- **Library:** `motion` (framer-motion successor; version in `apps/web/package.json`) drives a
  few components that need springs or layout animation, such as `motion-tabs`,
  `motion-highlight` and the celebrations. Everything else is **CSS Tailwind transitions** +
  `tw-animate-css` overlay animations + `@theme` keyframes.
- **Durations & easing:** `globals.css` sets `--default-transition-duration: 310ms`, so a bare
  `transition-colors` runs 310ms. Controls set their own: the UI primitives (Button, Badge,
  tabs) use `duration-150 ease-out` for press and hover feedback; enter animations run about
  200ms.
- **What animates:** `transform`, `opacity` — **not layout** (width/height/top/margin).
  Two exceptions are deliberate: hiding the sidebar (the width it leaves) and disclosures that animate
  `grid-template-rows` from `0fr` to `1fr`. Name the properties you transition; `transition-all`
  animates layout by accident.
  Active state nudges with `scale(0.995)`, shared as the `press` utility in `globals.css`
  (buttons, tabs, toggles, rows, cards; off under reduced motion); overlays use `animate-in/out` + `fade` + `zoom-95` +
  slide.
- **Tokens:** animations are `--animate-*` aliases in `@theme` (accordion, roll-up/down,
  rotate-once, reasoning and shimmer text, the button loading sweep, caret blink, the chat
  input border, and others). Add new keyframes there.
- **Enter and feedback:** `content-in` / `content-rise` (200ms fade, small rise) for page and list
  arrival, `check-pop` for copy/save confirmation, `scroll-edge-y` for scroll-edge fades. Opacity and
  transform only. Under reduced motion overlays cross-fade in place.
- **Reduced motion:** respected — heavy/ambient motion slows rather than dies;
  `agent-card-roll-up` disables under `prefers-reduced-motion`. Use `motion-safe:`/`motion-reduce:`
  for flourishes. Never animate a focus ring's appearance.

## Iconography

- **lucide-react** (pin in `apps/web/package.json`) is the icon library. `react-icons` appears
  only where a third-party brand glyph is needed; no heroicons/radix-icons.
- **Sizing:** **`size-4` is canonical** (auto-applied to unsized SVGs in primitives via
  `[&_svg:not([class*='size-'])]:size-4`); badges force `size-3`; other sizes `size-3.5/5/6/8`.
  Any equal width and height, icon or not, is `size-N` (including `size-full`), never `h-N w-N`.
- Icons clarify, not decorate — if removing one loses no meaning, remove it. lucide hides its
  icons from assistive tech by itself (see Accessibility).

## Imagery & Visuals

- **Ink** represents the movement/flow of AI agents — fluid, 2D, shaping figures; layering adds
  depth. Used in place of icons/stock for
  abstract concepts; brand-color gradients add vibrancy in imagery. In the UI, gradients are
  fades, scrims and masks, plus two brand rings (the hero search and the chat input border).
- **No glow or blur** (guide 5.5): depth comes from borders and, for floating overlays, a shadow up to `shadow-lg`.
- **Generative art** is on-brand (agents create visuals from words). **Photography** is organic
  and natural — abstract macro, grain, brand-tinted, depth-of-field softness; avoid harsh stock.
- **Decorative grid** lines may appear subtly on calm backgrounds; never compete with ink.
- In product: offer previews are **content-aware mocks** (slide/doc/chart/checklist/code/
  wireframe/video/text), not fake content; coworker avatars are shown whole.
- **Release announcements** ("New in Sokosumi" images) share one template, whose colours come
  from `globals.css`. Run `/create-new-in-sokosumi` with a PR or any context to get one;
  see [the skill](../../.agents/skills/create-new-in-sokosumi/SKILL.md).

## Accessibility

- **Focus rings — three conventions, by surface.**
  - **Form primitives** (Input, Select, Checkbox, Switch, Tabs, Textarea, ToggleGroup, Badge):
    the field marks focus with its border, `outline-none focus-visible:border-ring`
    (+ `aria-invalid:border-destructive`). No ring.
  - **Buttons:** `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
    focus-visible:ring-offset-background`, one ring for every variant so the destructive
    button is not the faintest. The Dialog and Sheet close buttons draw the same ring on
    `focus:`.
  - **Bespoke clickable cards and chips** (marketplace, offer picker): a local `FOCUS_RING`
    constant, `outline-none focus-visible:ring-2 focus-visible:ring-ring
    focus-visible:inset-ring-1 focus-visible:inset-ring-ring`.

  Reuse the one that matches the surface. A ring always has a width (`ring-2`):
  `ring-ring` alone sets only its colour and, next to `outline-none`, leaves no focus mark at
  all. Never animate the ring: a ring is a `box-shadow`, so keep `box-shadow` out of the
  transition (no `transition`, `transition-all` or `transition-shadow` on a focusable
  element). Never fade it with a modifier. Guard:
  `apps/web/src/lib/utils/__tests__/src-walk-guards.test.ts`.
- **Decorative icons:** lucide-react adds `aria-hidden="true"` to any icon that has no
  accessibility prop, so don't pass it by hand. `react-icons` glyphs do need `aria-hidden`.
- **Icon-only / unlabeled controls:** because the icon is hidden, every icon-only control needs
  a name (the guard checks every `<Button size="icon">`): `aria-label` (sourced from i18n);
  search inputs mirror the
  placeholder into `aria-label`; toggles add `aria-pressed`; otherwise pair with
  `<span className="sr-only">`.
- **Images:** decorative `alt=""` (or `aria-hidden`); meaningful images get a real `alt`; avatars
  use `AvatarFallback` initials.
- **Touch targets:** every icon-only control has a tap target of at least `size-10` (40px)
  below `md` and `size-8` (32px) from `md` up. `size="icon"` is already `size-10`; to compact it
  on desktop write `size-10 md:size-8`, never smaller than `md:size-8`. Where the painted box
  must stay small (dense toolbars, inline dismiss), keep it and add `hit-area`
  (`globals.css`): a transparent `::after` grows the target to 40px / 32px around the control.
  - Give it room: two `hit-area` neighbours need a gap of at least 40px minus the box below
    `md` (a `size-7` pair needs `gap-3`), or their targets overlap. Where the gap is smaller,
    grow the boxes instead.
  - A scroll container (`overflow-*-auto`) or `overflow-hidden` ancestor clips the `::after`;
    pad the container (`-m-1.5 p-1.5`) or grow the control.
  - `hit-area` sets `position: relative`; `absolute` and `fixed` on the same element still win.
  - **Chips:** a chip's remove (or other end action) is `ChipRemoveButton`
    (`src/components/ui/chip-remove-button.tsx`), a square end segment the full chip height:
    40px below `md`, so the chip itself grows to 40px there and no pseudo-element reaches the
    next row of a wrapping list; 28px plus `hit-area` (32px) from `md` up. The chip drops its
    end and block padding (`py-0 pe-0`); a `Badge` also needs `overflow-visible`, because it
    clips. Where the chip is itself a target (a preview tile), put the remove beside or under
    it as its own full-size control, never on top of it.
  - Guard: `src/lib/utils/__tests__/src-walk-guards.test.ts` checks every `size="icon"` tag,
    every bespoke `<button>` whose only child is an `X` (it needs `hit-area` or a 40px box), and
    that no `Badge` holds a bespoke `<button>`. It cannot see classes passed through a variable,
    other icon-only `<button>`s, or overlap between rows, so hold those to the same rule in
    review.

## Voice & Content

- **Sentence case** for headings, labels, titles, and CTAs ("Create task", "Invite member",
  "Back to credits"). Capitals stay only on proper nouns: product and feature names (Soko Bot,
  Content Studio, Social Scheduling), legal document titles (Terms of Service, Privacy
  Policy), other brands, and acronyms (API, OAuth, URL). Two names are quoted as-is: the
  Files area as a destination ("Copy to Files") and the Ready task status ("Reopen to
  Ready"). `src/lib/utils/__tests__/messages-sentence-case.test.ts` flags new Title Case in
  `messages/en.json`; add a new proper noun to its allowlist.
- **CTAs:** imperative, verb-first ("Submit rating", "Move to workspace", "Start a task").
  A destructive confirm names its action ("Delete", "Remove member"), next to "Cancel".
- **Errors:** say what failed. `Failed to {verb} {noun}` ("Failed to create job") is the house
  form; "Couldn't…" also appears, but new copy uses "Failed to".
- **Success:** a short past-tense statement ("Seat assigned", "Invites sent");
  "successfully" is optional.
- **i18n:** next-intl, `useTranslations`/`getTranslations` with **deep dot-namespaced keys**
  mirroring the route/component tree. Place
  new strings under the matching namespace. **Shipped locales: `en`, `de`, `es`** (default `en`).

## Logo

Wordmark + Kanji (lockup = Kanji right of wordmark, aligned to the 'i'). Generous clearspace
(2× the wordmark 's' on small formats). **Min sizes:** 14px wordmark / 30px lockup (web). On busy
or colored backgrounds, use the logo in neutral **black or white**; the Kanji may take the brand
primary on a neutral background. Brand names are always lowercase.

## Do's and Don'ts

**Do**
- Keep neutrals as the base and Iris Flower as the one accent fill; let other palette
  colours (charts, status) appear only when they communicate.
- Use Inter (all weights), sentence case, the alignment rules above, the Tailwind type scale.
- Separate sections with full-bleed segmented lines; lean on borders, not glow or blur.
- Build pages from the three layers: white page, borderless light-gray panel, white bordered
  components. Fill the width of `main`.
- Reuse the documented focus rings; give every icon-only control an `aria-label`.
- Reference semantic tokens; edit values in `globals.css` (no JS config).

**Don't**
- ALL CAPS headlines, right-aligned prose, or justified text.
- Flat color washes or gradient fills; multiple accent hues competing in one view (a flat
  violet header wash was tried and rejected).
- Off-brand palettes (e.g. stock shadcn chart colors) — use the ecosystem.
- Shadows above `shadow-lg`; arbitrary `text-[…]` sizes; `transition-all`; animating layout
  outside the two documented exceptions.
- Chromatic brand colors carrying small text — keep text/icons neutral on tints.
- Opacity modifiers on colour utilities (`bg-primary/55`, `border-border/40`) or
  `color-mix(…, transparent)` tints — use a neutral step (`--border`,
  `--quinary`, `--muted`) or a named token (`--overlay`).
- Going above `z-50` outside the two listed surfaces, or hardcoding hex / px radii.
- A centred `mx-auto max-w-*` page column, a bordered panel, or a white component sitting
  directly on the white page.
