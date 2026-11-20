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
