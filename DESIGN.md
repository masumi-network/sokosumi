---
version: alpha
name: Sokosumi
description: >-
  Design system for Sokosumi — the AI-agent marketplace in the Sumi (AGENTIC)
  family alongside masumi (blockchain layer) and kodosumi (the code). Deep-purple
  primary on a neutral-gray base, Inter throughout, sentence case, segmented
  full-bleed lines, soft glow for depth. Sokosumi is the "vessel" where masumi
  (warm) and kodosumi (cool) palettes meet — its only chromatic accents beyond the
  purple come from those two ecosystems. Tokens are CSS-first (Tailwind v4
  `@theme` in apps/web/src/app/globals.css); there is no tailwind.config. shadcn/ui
  (new-york, neutral base, lucide) over Radix.
colors:
  background: "#FFFFFF"
  foreground: "#0A0A0A"
  card: "#FAFAFA"
  muted: "#F5F5F5"
  mutedForeground: "rgba(10,10,10,0.5)"
  border: "#E6E6E6"
  input: "#E6E6E6"
  ring: "#6400FF"
  primary: "#6400FF"          # Wisteria Purple 藤色
  primaryForeground: "#FAFAFA"
  secondary: "rgba(10,10,10,0.95)"
  accent: "#F5F5F5"
  destructive: "#FA140A"      # masumi Scarlet — error only
  category1: "#00A4FA"        # kodosumi Sky Blue   (--chart-1)
  category2: "#FA008C"        # masumi Electric Pink (--chart-2)
  category3: "#0AFA14"        # kodosumi Neon Grass (--chart-3)
  category4: "#FFD300"        # masumi Golden Yellow (--chart-4)
  category5: "#FF6400"        # masumi Persimmon    (--chart-5)
  neutral50: "#FAFAFA"
  neutral100: "#F5F5F5"
  neutral200: "#E5E5E5"
  neutral300: "#D4D4D4"
  neutral400: "#A3A3A3"
  neutral500: "#737373"
  neutral600: "#525252"
  neutral700: "#404040"
  neutral800: "#262626"
  neutral900: "#171717"
  neutral950: "#0C0C0C"
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
    textColor: "{colors.mutedForeground}"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primaryForeground}"
    rounded: "{rounded.md}"
    height: 36px
    padding: 8px 16px
    typography: "{typography.label}"
  buttonHover:
    backgroundColor: "color-mix(in oklab, {colors.primary} 90%, transparent)"
  buttonSm:
    height: 32px
    padding: 0 12px
  buttonIcon:
    size: 36px
  input:
    height: 36px
    rounded: "{rounded.md}"
    backgroundColor: transparent
  badge:
    rounded: "{rounded.md}"
    padding: 2px 8px
    typography: "{typography.caption}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: 24px
  dialog:
    rounded: "{rounded.lg}"
    padding: 24px
  searchHero:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.background}"
    rounded: "{rounded.full}"
    height: 56px
  categoryChip:
    rounded: "{rounded.md}"
    padding: 2px 8px
    typography: "{typography.caption}"
  focusRing:
    ring: "color-mix(in oklab, {colors.ring} 50%, transparent)"
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
where masumi and kodosumi meet, so its own surface is **deep-purple primary on a neutral-gray
base**; everything else is simplified to gray so the sibling palettes (and the work) stand
out. Brand names and the first letter of any brand are always **lowercase**; UI copy is
**sentence case**.

- **Aesthetic:** intricate minimalism — Linear/Notion precision with a warm, human edge.
- **Color discipline:** purple + neutrals carry the UI; chromatic color appears **only when it
  communicates** (category, status, action), at most one accent role per view.
- **Theming:** dark mode is a `.dark` class that re-defines the same token names; reference one
  token and theming is automatic. `--radius` and the category palette are identical across modes.

## Colors

### Primary — Wisteria Purple (藤色), themeable

`--primary: #6400FF` (`hsla(264, 100%, 50%, 1)`). Brand-sanctioned alternate primaries (swap
`--primary` only; keep everything else neutral): Sky Blue `#00A4FA`, Light Teal `#0AFED3`,
Neon Grass `#0AFA14`, Young Grass `#C4FE0A`, Persimmon `#FF6400`, Iris `#FF51FF`. The primary
family also exposes `--primary-variant/-tertiary/-quaternary/-quinary` (decreasing alpha) and
`--primary-iris` for tints and gradients.

### Neutrals

Black/White + the neutral ramp `#FAFAFA → #0C0C0C` plus a black-alpha ramp
(`--secondary/-tertiary/-quaternary/-quinary/-senary` and `--alpha-5…95`). Elevated surfaces are
**lighter** (card `#FAFAFA` on muted `#F5F5F5`), not heavier. Default border = `--border`; the
base layer applies `border-border` + `outline-ring/50` to all elements.

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
accents) or **soft 15% tints** (chips); keep adjacent text/icons **neutral** for contrast.

### Token families (reference)

Beyond the above, `globals.css` exposes: **semantic** (`--destructive/critical/warning/success/
info`, each with `-variant/-tertiary/-quaternary/-quinary/-foreground/-ring`); **material**
translucent surfaces (`--material-ultrathin → -ultrathick`, each with `-overlay`) for blur/glass
UI; **sidebar-** set; and `card/popover/border/input/ring/ring-semantic`. Use semantic tokens
(`bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring`) — never hardcoded hex.

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
- **Full-bleed:** visuals/bands may break out. The marketplace hero uses `-mx-6 -mt-4` to escape
  page padding; the agent-detail route opts out of shell clipping via a `data-agent-fullbleed`
  marker (`globals.css`).

## Elevation & Depth

Borders-first, then soft glow — **never** dramatic drop shadows.

- Define regions with **hairline borders/rings** (`ring-1 ring-border`, `border-border/60`).
- **Soft glow:** subtle shadows for lift (`shadow-sm` → `shadow-md` on hover), echoing the
  brand's "blur & glow." No shadow **token scale** exists — use Tailwind `shadow-*` defaults or
  the two custom utilities (`agent-card-image-shadow`, `agent-modal-card`); keep it subtle.
- **Blur:** `backdrop-blur` for elements over busy backgrounds (dialog overlay = `bg-background/50
  backdrop-blur-lg`); pairs with the **material** translucent-surface tokens.
- **Z-index:** no formal ladder. **`z-50` is the standard overlay layer** (dropdowns, popovers,
  modals); `z-10` for local stacking. Don't invent new high values.

## Shapes

- **Radius scale (off `--radius: 0.625rem` = 10px):** `sm 6 · md 8 · lg 10 · xl 14`; plus
  Tailwind defaults `2xl 16` (cards/hero) and `full` (search pill, filter chips, avatars).
  Use `rounded-sm/md/lg/xl` — don't hardcode px radii.
- **Segmented lines:** a thin line anchors content to the grid and acts as **separator** — used
  to define sections and delineate cards. In-app these are **full-bleed**
  (`-mx-6 border-t border-border/60`) between major blocks and company groups.
- Avatars are **circular** for people; square source art is shown **whole** (no crop).

## Components

shadcn/ui wrappers over Radix in `apps/web/src/components/ui/`; each carries a `data-slot`.
Variants via `class-variance-authority` (only Button & Badge); others are prop/state-driven.

- **Button** — 8 variants: `primary` (bg-primary), `default` (bg-secondary, *default*),
  `destructive`, `outline`, `secondary` (bg-quinary), `ghost`, `link`, `muted`. 4 sizes:
  `default` (h-9 px-4), `sm` (h-8 px-3), `lg` (h-10 px-6), `icon` (size-9). Base:
  `cursor-pointer transition-all disabled:opacity-50`, hover per-variant (`hover:bg-primary/90`),
  embedded SVG defaults to `size-4`.
- **Input** — h-9, `rounded-md border-input bg-transparent`, `text-base md:text-sm`.
- **Badge** — 4 variants (default/secondary/destructive/outline), `px-2 py-0.5 text-xs rounded-md`,
  SVG `size-3`.
- **Card** — `bg-card rounded-xl border py-6`, with Header/Title(`font-semibold`)/Description
  (`text-muted-foreground text-sm`)/Content/Footer; `px-6` insets.
- **Dialog** — centered, `max-w-[calc(100%-2rem)] sm:max-w-lg`, `rounded-lg border p-6`; overlay
  `bg-background/50 backdrop-blur-lg`; built-in close button; open/close = fade + zoom-95.
- **Select / DropdownMenu / Tabs / Tooltip / Switch / Checkbox** — token-driven; states via
  Radix `data-[state=…]` + `focus-visible:ring-ring/50 ring-[3px]`; tabs/list `bg-muted h-9
  rounded-lg`; tooltip `bg-primary text-primary-foreground text-xs`.
- **Marketplace components** (`components/agents/coworker-gallery-section.tsx`): full-bleed
  **hero search** (black `rounded-full` pill); **company group** (header → coworker tiles →
  "Ready-to-run offers" sub-block, capped 2/5/3 with "Show all"); **coworker tile**
  (circular avatar + name + role + model/region tags); **offer card** (content-aware preview
  mock + category chip + output-type chip + coworker); **offer detail dialog** (`max-w-4xl`,
  ~56vh preview, real PDF/Office embed, multi-output tabs).

## Motion

- **Library:** `motion` v12 (framer-motion successor) is used **only** in two primitives
  (`motion-tabs`, `motion-highlight`). Everything else is **CSS Tailwind transitions** +
  `tw-animate-css` overlay animations + `@theme` keyframes.
- **Durations & easing:** `duration-200` is the default (also 300/500); standard easing is
  **`ease-out` at 0.2–0.25s** for UI transitions. `transition-colors` is the hover workhorse;
  feedback should stay **≤200ms**.
- **What animates:** `transform`, `opacity`, `blur` — **never layout** (width/height/top/margin).
  Active state nudges with `scale(0.995)`; overlays use `animate-in/out` + `fade` + `zoom-95` +
  slide.
- **Tokens:** animations are `--animate-*` aliases (accordion 0.2s, roll-up/down 0.2s,
  rotate-once 0.6s, reasoning-* shimmer/step/cursor). Add new keyframes there.
- **Reduced motion:** respected — heavy/ambient motion (hermes blobs) slows rather than dies;
  `agent-card-roll-up` disables under `prefers-reduced-motion`. Use `motion-safe:`/`motion-reduce:`
  for flourishes. Never animate a focus ring's appearance.

## Iconography

- **lucide-react** (pinned **1.18.0**) is the icon library (~197 files). `react-icons` appears in
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
  focus-visible:ring-ring/50 focus-visible:ring-[3px]` (+ `aria-invalid:ring-destructive/20
  aria-invalid:border-destructive`). Bespoke clickable cards/chips: `outline-none
  focus-visible:ring-2 focus-visible:ring-primary/30` (use /30–/40; /50 on the dark hero). Reuse
  these verbatim; never animate the ring.
- **Decorative icons:** boolean shorthand `aria-hidden` (bare attribute, the dominant style).
- **Icon-only / unlabeled controls:** `aria-label` (sourced from i18n); search inputs mirror the
  placeholder into `aria-label`; toggles add `aria-pressed`; otherwise pair with
  `<span className="sr-only">`.
- **Images:** decorative `alt=""` (or `aria-hidden`); meaningful images get a real `alt`; avatars
  use `AvatarFallback` initials.
- **Touch targets:** there is **no deliberate 44px convention** — icon buttons are often `size-7/8`
  and `size="icon"` is 36px. For mobile-first surfaces, bump tap targets explicitly.

## Voice & Content

- **Sentence case** for headings, labels, titles, and CTAs (legacy Title Case in the
  Organizations/Members area is *not* the standard — don't copy it).
- **CTAs:** imperative, verb-first ("Submit rating", "Move to workspace", "Start a task");
  destructive dialogs use bare "Confirm"/"Cancel".
- **Errors:** `Failed to {verb} {noun}` ("Failed to create job"), with fallback suffix
  ", please contact our support" for unknown/on-chain errors.
- **Success:** `{Noun} {verbed} successfully` ("Seat assigned successfully").
- **i18n:** next-intl, `useTranslations`/`getTranslations` with **deep dot-namespaced keys**
  mirroring the route/component tree (11 top-level domains; ~2,580 strings in `en.json`). Place
  new strings under the matching namespace. **Shipped locales: `en`, `de`, `es`** (default `en`)
  — extra catalog files on disk are not wired up.

## Logo

Wordmark + Kanji (lockup = Kanji right of wordmark, aligned to the 'i'). Generous clearspace
(2× the wordmark 's' on small formats). **Min sizes:** 14px wordmark / 30px lockup (web). On busy
or colored backgrounds, use the logo in neutral **black or white**; the Kanji may take the brand
primary on a neutral background. Brand names are always lowercase.

## Do's and Don'ts

**Do**
- Keep purple + neutral gray as the base; let ecosystem color appear only with meaning.
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
- Inventing new z-index values above `z-50`, or hardcoding hex / px radii.
