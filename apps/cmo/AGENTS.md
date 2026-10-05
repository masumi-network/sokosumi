# CMO app

CMO is the product at cmo.xyz (see **CMO** and **Sign in with Sokosumi** in [CONTEXT.md](../../CONTEXT.md), and [ADR 0045](../../docs/adr/0045-cmo-signs-in-through-core-oauth-provider.md)). This app is its own Next.js deployment at app.cmo.xyz, not part of Web.

- **Own components.** Build every component inside `apps/cmo`; Web's components stay Web's.
- **Temporary brand.** The CMO.XYZ-Style-Guide repository (`DESIGN.md`) is the brand source, and its colours, logo, and PP Mori files are still open. Theme tokens live in `src/app/globals.css`, marked temporary; take every colour and font from those tokens until design locks the real values. Copy follows the guide's voice rules: plain and short, with minimal to no em dashes or hyphens.
- **Mascot.** The mascot is called Cuso. `public/mascot.glb` and `public/mascot.webp` come from the style guide's `3D Mascot` folder, shrunk with `npx @gltf-transform/cli optimize --compress quantize --texture-compress webp --texture-size 2048 --simplify false` and an 800px WebP. `src/components/mascot.tsx` renders it with three.js over the still image. The logo mark (`public/logo.svg`, shown by `src/components/logo.tsx`) and the app icons (`public/icon.svg`, `favicon.ico`, `apple-icon.png`, linked from `metadata.icons` in `src/app/layout.tsx`) redraw the mascot's pointer with eyes as flat vector art. They live in `public/` so their URLs stay stable for outside links. `icon.svg` has a transparent background and a black outline so it reads on light and dark browser tabs; `favicon.ico` (16, 32, 48 px) is rasterised from it, so change the SVG first. `apple-icon.png` keeps a solid black tile because iOS fills transparency with black.
- **Server-side Sokosumi.** CMO holds no database. Its server reaches Sokosumi through Core's OAuth provider and `/v1`. A person with no workspace passes CMO's own identity onboarding over `/v1/users/me/workspaces` first ([ADR 0051](../../docs/adr/0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md)).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
