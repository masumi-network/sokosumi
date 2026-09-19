---
version: alpha
name: Sokosumi
description: >-
  Design system for Sokosumi — the AI-agent marketplace in the Sumi (AGENTIC)
  family alongside masumi (blockchain layer) and kodosumi (the code). Deep-blue
  primary on a neutral-gray base, Inter throughout, sentence case, segmented
  full-bleed lines, soft glow for depth. Sokosumi is the "vessel" where masumi
  (warm) and kodosumi (cool) palettes meet — its only chromatic accents beyond the
  primary come from those two ecosystems. Tokens are CSS-first (Tailwind v4
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
    fontWeight: 300
    fontSize: 20px
    lineHeight: 28px
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
    textColor: muted-foreground
rounded:
  sm: 6px      # --radius - 4px
  md: 8px      # --radius - 2px
  lg: 10px     # --radius (0.625rem)
  xl: 14px     # --radius + 4px
  2xl: 16px    # Tailwind default (used directly for cards/hero)
  full: 9999px
spacing:        # Tailwind default 4-pt scale (no custom --spacing token)
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
    backgroundColor: primary-solid
    textColor: primary-solid-foreground
    rounded: "{rounded.md}"
    height: h-10
    padding: 8px 16px
    typography: text-sm font-medium
  buttonHover:
    backgroundColor: primary-solid-hover
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
    typography: "{typography.caption}"
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
    typography: "{typography.caption}"
  focusRing:
    ring: ring-ring-halo
    width: 3px
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
where masumi and kodosumi meet, so its own surface is **deep-blue primary on a neutral-gray
base**; everything else is simplified to gray so the sibling palettes (and the work) stand
out. Brand names and the first letter of any brand are always **lowercase**; UI copy is
**sentence case**.

- **Aesthetic:** intricate minimalism — Linear/Notion precision with a warm, human edge.
- **Color discipline:** deep-blue primary + neutrals carry the UI; chromatic accents appear
  **only when they communicate** (masumi/kodosumi charts, status, category), at most one
  accent role per view.
- **Theming:** dark mode is a `.dark` class that re-defines the same token names; reference one
  token and theming is automatic. `--radius` and the category palette are identical across modes.

## Colors

### Primary — Sokosumi Blue, themeable

The primary is Sokosumi Blue. Light and dark values live in `globals.css`; dark mode
raises the lightness so accent text and focus rings remain visible on dark surfaces.
The working status uses a separate magenta hue, and the former `semantic-info` role
has been consolidated into `status-working`.

The primary family exposes `--primary-solid` (fill under a near-white label),
`--primary-variant`, opaque ramp steps `--primary-tertiary/-quaternary/-quinary`
(border / hover fill / resting fill), and `--primary-iris` for gradients. Never invent
a tint at the call site (`bg-primary/55`, `color-mix(…, transparent)`); if no step fits,
add one in `globals.css`.

### Neutrals

Black/White + the neutral ramp `#FAFAFA → #0C0C0C` plus the step ramp
(`--secondary/-tertiary/-quaternary/-quinary/-senary`). Elevated surfaces are
**lighter** (card `#FAFAFA` on muted `#F5F5F5`), not heavier. Default border = `--border`;
`--input` is a separate, stronger control boundary. The base layer applies `border-border` +
`outline-ring` to all elements.

### Category palette (ecosystem)

Category accents come from the **real masumi (warm) + kodosumi (cool)** palettes, mapped to
`--chart-1…5` — **never** stock shadcn chart defaults:

| Token | Hex | Source |
| --- | --- | --- |
| `--chart-1` | `#00A4FA` | kodosumi · Sky Blue |
| `--chart-2` | `#FA008C` | masumi · Electric Pink |
| `--chart-3` | `#0AFA14` | kodosumi · Neon Grass |
| `--chart-4` | `#FFD300` | masumi · Golden Yellow |
| `--chart-5` | `#FF6400` | masumi · Persimmon |

These are vivid (built for fills/ink, not small text). Use as **solid fills** (badges, mock
accents) or **`-quinary` resting fills** (chips — `--chart-N-quinary`); keep adjacent
text/icons **neutral** for contrast.

### Token families (reference)

Beyond the above, `globals.css` exposes: **semantic** (`--destructive/warning/success/
info`, each with `-tertiary/-quaternary/-quinary/-label/-foreground`; destructive also has
`-solid` for a fill that carries a near-white label); **overlay / glass** tokens
(`--overlay`, `--overlay-primary`, `--surface-glass`, `--scrim/-soft/-strong`) for blur/glass
UI (alpha lives in the token, not at the call site); **sidebar-** set; and
`card/popover/border/input/ring/ring-halo`. Use semantic tokens
(`bg-primary`, `text-muted-foreground`, `border-input`, `bg-primary-solid`, `ring-ring-halo`) —
never hardcoded hex, never an opacity modifier on a colour utility.

## Typography

**Inter** is the entire system.

- **Inter Light (300)** — headlines & hero (airy, sophisticated). Section headings
  `text-xl md:text-2xl font-light`; hero `text-2xl md:text-3xl font-light`.
- **Inter Regular (400)** — body & UI (the workhorse; base `text-sm`/14px).
- **Inter Medium (500) / Semibold (600)** — subtle emphasis: labels, subheadings, callouts.
- **Scale:** pentatonic — base **12px**, ×2 every 5 steps (`r = 2^(1/5) ≈ 1.1487`); Light kicks
  in ~20px+, with **negative tracking** growing at large sizes. Stick to the Tailwind scale
  (`text-xs/sm/base/lg/xl/2xl/3xl`) — no off-scale `text-[13px]`-style values.
- **Case:** **Sentence case** headlines — never all-caps. **Alignment:** left or centered only.
- Use `text-balance` on headings, `text-pretty` on body.

## Layout

- **CSS-first, no JS config.** Breakpoints are Tailwind defaults (`sm 640 · md 768 · lg 1024 ·
  xl 1280 · 2xl 1536`); **`md` is the primary mobile/desktop split** (sidebar hidden→flex,
  header sticky). `2xl` is effectively unused.
- **App shell:** sidebar + a sticky header, `<main class="… p-4 …">` (overflow-y-auto). Page
  wrappers add `px-2` inside main, so content sits ~24px from the main edge.
- **Container:** one custom `.container` — centered, full-width from `sm`, capped at **1400px**.
- **Spacing:** Tailwind 4-pt scale (no custom token). Common: gaps `gap-2/3/4`, vertical rhythm
  `space-y-4/6`, top-level page sections `space-y-12`; tight inline groups `gap-1/1.5`.
- **Grid patterns:** coworker tiles `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`;
  offer cards `sm:grid-cols-2 lg:grid-cols-3`; forms/content `sm:grid-cols-2`.
- **Full-bleed:** visuals/bands may break out. The marketplace hero uses `-mx-4 -mt-4` to escape
  page padding; the agent-detail route opts out of shell clipping via a `data-agent-fullbleed`
  marker (`globals.css`).

## Elevation & Depth

Borders-first, then soft glow — **never** dramatic drop shadows.

- Define regions with **hairline borders/rings** (`ring-1 ring-border`, `border-border`).
- **Soft glow:** subtle shadows for lift (`shadow-sm` → `shadow-md` on hover), echoing the
  brand's "blur & glow." No shadow **token scale** exists — use Tailwind `shadow-*` defaults or
  the two custom utilities (`agent-card-image-shadow`, `agent-modal-card`); keep it subtle.
- **Blur:** `backdrop-blur` for elements over busy backgrounds (dialog overlay = `bg-overlay
  backdrop-blur-lg`); pairs with the overlay / glass tokens (`--overlay`, `--surface-glass`).
- **Z-index:** no formal ladder. **`z-50` is the standard overlay layer** (dropdowns, popovers,
  modals); `z-10` for local stacking. Don't invent new high values.

## Shapes

- **Radius scale (off `--radius: 0.625rem` = 10px):** `sm 6 · md 8 · lg 10 · xl 14`; plus
  Tailwind defaults `2xl 16` (cards/hero) and `full` (search pill, filter chips, avatars).
  Use `rounded-sm/md/lg/xl` — don't hardcode px radii.
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
  `apps/web/src/lib/utils/__tests__/full-bleed-rules.test.ts`.
  A centred column inside a `max-w-*` wrapper keeps its own padding and is out of scope: no
  rule crosses the view there.
- Avatars are **circular** for people; square source art is shown **whole** (no crop).
- **Whole pixels:** every layout and border length is a whole number of CSS pixels. A 1x
  display, which is most Windows hardware, has no half pixel, so a `1.5px` border rounds to
  1px on one edge of a box and 2px on the opposite one, and a `0.2px` border rounds away to
  nothing. Blur radii, keyframe translations and unitless scale factors are continuous and
  stay fractional. See [Whole pixels](.cursor/rules/whole-pixels.mdc).

## Components

shadcn/ui wrappers over Radix in `apps/web/src/components/ui/`; each carries a `data-slot`.
Variants via `class-variance-authority` (only Button & Badge); others are prop/state-driven.

- **Button** — 8 variants: `primary` (bg-primary-solid), `default` (bg-secondary, *default*),
  `destructive`, `outline`, `secondary` (bg-quinary), `ghost`, `link`, `muted`. 4 sizes:
  `default` (h-10 px-4), `sm` (h-8 px-3), `lg` (h-10 px-6), `icon` (size-10). Default control
  height is `h-10` (scales with root rem; Dynamic Type cap 1.25×). Base:
  `cursor-pointer transition-all disabled:opacity-50`, hover per-variant
  (`hover:bg-primary-solid-hover` / `hover:bg-secondary-hover` / `hover:bg-quaternary`),
  embedded SVG defaults to `size-4`.
- **Input** — h-10, `rounded-md border-input bg-transparent`, `text-base md:text-sm`
  (via `withEditableTextSize`).
- **Badge** — 4 variants (default/secondary/destructive/outline), `px-2 py-0.5 text-xs rounded-md`,
  SVG `size-3`.
- **Card** — `bg-card rounded-xl border py-6`, with Header/Title(`font-semibold`)/Description
  (`text-muted-foreground text-sm`)/Content/Footer; `px-6` insets.
- **Dialog** — centered, `max-w-[calc(100%-2rem)] sm:max-w-lg`, `rounded-lg border p-6`; overlay
  `bg-overlay backdrop-blur-lg`; built-in close button; open/close = fade + zoom-95.
- **Select / DropdownMenu / Tabs / Tooltip / Switch / Checkbox** — token-driven; states via
  Radix `data-[state=…]` + `focus-visible:ring-ring-halo ring-[3px]`; tabs/list `bg-muted h-9
  rounded-lg`; tooltip `bg-primary-solid text-primary-solid-foreground text-xs`.
- **Marketplace components** (`components/agents/coworker-gallery-section.tsx`): full-bleed
  **hero search** (inverted `bg-foreground` / `text-background` `rounded-full` pill); **company group** (header → coworker tiles →
  "Ready-to-run offers" sub-block, capped 2/5/3 with "Show all"); **coworker tile**
  (circular avatar + name + role + model/region tags); **offer card** (content-aware preview
  mock + category chip + output-type chip + coworker); **offer detail dialog** (`max-w-4xl`,
  ~56vh preview, real PDF/Office embed, multi-output tabs).

## Motion

- **Library:** `motion` 13.4.0 (framer-motion successor) is used in `motion-tabs`,
  `motion-highlight`, `purchase-success-modal`, `confetti-burst`, and
  `task-created-celebration`. Everything else is **CSS Tailwind transitions** +
  `tw-animate-css` overlay animations + `@theme` keyframes.
- **Durations & easing:** `duration-200` is the default (also 300/500); standard easing is
  **`ease-out` at 0.2–0.25s** for UI transitions. `transition-colors` is the hover workhorse;
  feedback should stay **≤200ms**.
- **What animates:** `transform`, `opacity`, `blur` — **never layout** (width/height/top/margin).
  Active state nudges with `scale(0.995)`; overlays use `animate-in/out` + `fade` + `zoom-95` +
  slide.
- **Tokens:** animations are `--animate-*` aliases (accordion 0.2s, roll-up/down 0.2s,
  rotate-once 0.6s, reasoning-* shimmer/step/cursor). Add new keyframes there.
- **Reduced motion:** respected — heavy/ambient motion slows rather than dies;
  `agent-card-roll-up` disables under `prefers-reduced-motion`. Use `motion-safe:`/`motion-reduce:`
  for flourishes. Never animate a focus ring's appearance.

## Iconography

- **lucide-react** (pin in `apps/web/package.json`) is the icon library (~197 files). `react-icons` appears in
  exactly one constants file for third-party brand glyphs; no heroicons/radix-icons.
- **Sizing:** **`size-4` is canonical** (auto-applied to unsized SVGs in primitives via
  `[&_svg:not([class*='size-'])]:size-4`); badges force `size-3`; other sizes `size-3.5/5/6/8`.
  Always `size-N`, never `h-N w-N`.
- Icons clarify, not decorate — if removing one loses no meaning, remove it. Decorative icons get
  `aria-hidden` (see Accessibility).

## Imagery & Visuals

- **Ink** represents the movement/flow of AI agents — fluid, 2D, shaping figures; layering adds
  depth, soft blur contrasts with sharp edges ("frosted glass"). Used in place of icons/stock for
  abstract concepts; brand-color gradients add vibrancy.
- **Blur & glow** are core: soft drop shadows for depth; blur for legibility on busy backgrounds.
- **Generative art** is on-brand (agents create visuals from words). **Photography** is organic
  and natural — abstract macro, grain, brand-tinted, depth-of-field softness; avoid harsh stock.
- **Decorative grid** lines may appear subtly on calm backgrounds; never compete with ink.
- In product: offer previews are **content-aware mocks** (slide/doc/chart/checklist/code/
  wireframe/video/text), not fake content; coworker avatars are shown whole.

## Accessibility

- **Focus rings — two conventions.** shadcn primitives: `outline-none focus-visible:border-ring
  focus-visible:ring-ring-halo focus-visible:ring-[3px]` (+ `aria-invalid:ring-destructive-halo
  aria-invalid:border-destructive`). Bespoke clickable cards/chips: `outline-none
  focus-visible:ring-2 focus-visible:ring-ring`. Reuse these verbatim; never animate the
  ring, and never fade it with a modifier: `--ring-halo` is the soft wide glow, and it
  carries its own alpha so the class does not have to.
- **Decorative icons:** boolean shorthand `aria-hidden` (bare attribute, the dominant style).
- **Icon-only / unlabeled controls:** `aria-label` (sourced from i18n); search inputs mirror the
  placeholder into `aria-label`; toggles add `aria-pressed`; otherwise pair with
  `<span className="sr-only">`.
- **Images:** decorative `alt=""` (or `aria-hidden`); meaningful images get a real `alt`; avatars
  use `AvatarFallback` initials.
- **Touch targets:** there is **no deliberate 44px convention** — icon buttons are often `size-7/8`
  and `size="icon"` is `size-10`. For mobile-first surfaces, bump tap targets explicitly.

## Voice & Content

- **Sentence case** for headings, labels, titles, and CTAs (legacy Title Case in the
  Organizations/Members area is *not* the standard — don't copy it).
- **CTAs:** imperative, verb-first ("Submit rating", "Move to workspace", "Start a task");
  destructive dialogs use bare "Confirm"/"Cancel".
- **Errors:** `Failed to {verb} {noun}` ("Failed to create job"), with fallback suffix
  ", please contact our support" for unknown/on-chain errors.
- **Success:** `{Noun} {verbed} successfully` ("Seat assigned successfully").
- **i18n:** next-intl, `useTranslations`/`getTranslations` with **deep dot-namespaced keys**
  mirroring the route/component tree (11 top-level domains). Place
  new strings under the matching namespace. **Shipped locales: `en`, `de`, `es`** (default `en`).

## Logo

Wordmark + Kanji (lockup = Kanji right of wordmark, aligned to the 'i'). Generous clearspace
(2× the wordmark 's' on small formats). **Min sizes:** 14px wordmark / 30px lockup (web). On busy
or colored backgrounds, use the logo in neutral **black or white**; the Kanji may take the brand
primary on a neutral background. Brand names are always lowercase.

## Do's and Don'ts

**Do**
- Keep deep-blue primary + neutrals as the base; let chromatic accents (masumi/kodosumi
  charts, status) appear only when they communicate.
- Use Inter (all weights), sentence case, left/centered alignment, the Tailwind type scale.
- Separate sections with full-bleed segmented lines; lean on borders + soft glow + blur.
- Reuse the documented focus rings; `aria-hidden` decorative icons; `aria-label` icon-only controls.
- Reference semantic tokens; edit values in `globals.css` (no JS config).

**Don't**
- ALL CAPS headlines, or right-aligned / justified text.
- Flat color washes or gradients as decoration; multiple accent hues competing in one view (a flat
  violet header wash was tried and rejected).
- Off-brand palettes (e.g. stock shadcn chart colors) — use the ecosystem.
- Heavy/dramatic drop shadows; off-scale font sizes; animating layout properties.
- Chromatic brand colors carrying small text — keep text/icons neutral on tints.
- Opacity modifiers on colour utilities (`bg-primary/55`, `border-border/40`) or
  `color-mix(…, transparent)` tints — use the opaque ramp step (`-tertiary` /
  `-quaternary` / `-quinary`) or a named token (`--ring-halo`, `--overlay`).
- Inventing new z-index values above `z-50`, or hardcoding hex / px radii.
