# CMO app

CMO is the product at cmo.xyz (see **CMO** and **Sign in with Sokosumi** in [CONTEXT.md](../../CONTEXT.md), and [ADR 0045](../../docs/adr/0045-cmo-signs-in-through-core-oauth-provider.md)). This app is its own Next.js deployment, not part of Web.

- **Own components.** Build UI here; import nothing from `apps/web`.
- **Temporary brand.** The CMO.XYZ-Style-Guide repository (`DESIGN.md`) is the brand source, and its colours, logo, and PP Mori files are still open. Theme tokens live in `src/app/globals.css` and are marked temporary; change them there, never invent brand values at a call site. Copy follows the style guide's voice rules: plain, short, no em dashes or hyphens.
- **No data of its own.** CMO holds no database. It reaches Sokosumi only from its server, through Core's OAuth provider and `/v1`.
- **Environments.** Production is cmo.xyz against mainnet Core. `/deploy mainnet` builds a CMO preview beside Web and Core; there is no preprod CMO project. Run locally with `pnpm portless:cmo`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
