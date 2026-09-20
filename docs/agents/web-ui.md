# Web UI conventions

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
Commands and backticked paths are relative to the repository root unless stated otherwise.

### UI & Styling

- **Components**: Use Shadcn UI and Radix UI primitives
- **Styling**: Tailwind CSS with responsive design
- **Colors**: Use semantic tokens from `globals.css`. Never a raw Tailwind palette color
  (`bg-emerald-500`, `text-gray-400`, `bg-black`), never a hex/rgb/hsl literal, and never an
  opacity modifier on a color utility (`bg-primary/55`, `border-border/40`, `bg-primary/[0.04]`).
  Use the alpha-baked ramp step instead (`-tertiary` border, `-quaternary` hover, `-quinary`
  fill); if no step fits, add one to both theme blocks **and** bridge it in `@theme inline`,
  or the utility silently emits nothing. See
  [Color tokens](../../.cursor/rules/color-tokens.mdc).
- **Sizing**: Use `size-4` instead of `h-4 w-4`
- **Themes**: Ensure compatibility with both dark and light modes
- **Dynamic Type (iOS/macOS)**: Root rem may track Apple Dynamic Type (`-apple-system-body`); Inter stays the face; scale capped at **1.25×** (max 20px root). See `.cursor/rules/dynamic-type.mdc` and `apps/web/src/lib/utils/dynamic-type.ts`.
- **Font sizes**: Never use fixed `px` type in product UI (`text-[10px]`, `font-size: 12px`, `fontSize: 14`). Use Tailwind `text-*` or `rem`/`em` so type scales with root.
- **Whole pixels**: Never a fractional `px` on a layout or border length (`p-[1.5px]`, `padding: 1.5px`, `border: "0.2px solid …"`). A 1x display has no half pixel, so the browser rounds a `1.5px` border to 1px on one edge and 2px on the other. Blur radii, keyframe translations and unitless scale factors stay continuous. See [Whole pixels](../../.cursor/rules/whole-pixels.mdc).

### Key Conventions

- **URL State**: Use `nuqs` for URL search parameter state management
- **Client Components**: Limit `'use client'` usage
  - Favor server components and Next.js SSR
  - Use only for Web API access in small components
  - Avoid for data fetching or state management
- **Async Operations**: Use Suspense for async operations
- **Data Fetching**: Follow Next.js docs for Data Fetching, Rendering, and Routing
