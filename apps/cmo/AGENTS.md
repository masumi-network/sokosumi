# CMO app

CMO is the product at cmo.xyz (see **CMO** and **Sign in with Sokosumi** in [GLOSSARY.md](../../GLOSSARY.md), and [ADR 0045](../../docs/adr/0045-cmo-signs-in-through-core-oauth-provider.md)). This app is its own Next.js deployment at app.cmo.xyz, not part of Web.

- **Own components.** Build every component inside `apps/cmo`; Web's components stay Web's.
- **Submit buttons.** Use `SubmitButton`; it shows the loading bar and keeps the pressed button focused.
- **Brand.** Read [`DESIGN.md`](DESIGN.md) before UI or copy work: it is CMO's brand guide (voice, typeface, what is still open), separate from Web's. It is a copy of the CMO.XYZ-Style-Guide repository; change the brand there and re-copy. Colours, logo, shapes, and PP Mori files are still open, so theme tokens in `src/app/globals.css` are marked temporary; take every colour and font from those tokens until design locks the real values. `src/design-guards.test.ts` holds the locked rules: colour literals only in the `:root` block of `globals.css`, the face only through `--font-sans`, no em dashes, hedges or hardcoded agent name in copy, an `alt` on every image, and no removed focus outline.
- **Mascot.** The mascot is called Cuso. `public/mascot.glb` and `public/mascot.webp` come from the style guide's `3D Mascot` folder, shrunk with `npx @gltf-transform/cli optimize --compress quantize --texture-compress webp --texture-size 2048 --simplify false` and an 800px WebP. `src/components/mascot.tsx` renders it with three.js over the still image. The logo mark (`public/logo.svg`, shown by `src/components/logo.tsx`) and the app icons (`public/icon.svg`, `favicon.ico`, `apple-icon.png`, linked from `metadata.icons` in `src/app/layout.tsx`) redraw the mascot's pointer with eyes as flat vector art. They live in `public/` so their URLs stay stable for outside links. `icon.svg` has a transparent background and a black outline so it reads on light and dark browser tabs; `favicon.ico` (16, 32, 48 px) is rasterised from it, so change the SVG first. `apple-icon.png` keeps a solid black tile because iOS fills transparency with black.
- **Server-side Sokosumi.** CMO holds no database. Its server reaches Sokosumi through Core's OAuth provider and `/v1`. A person with no workspace passes CMO's own identity onboarding over `/v1/users/me/workspaces` first ([ADR 0051](../../docs/adr/0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md)).

## Run CMO locally against a local Core

Cuso needs Core's CMO routes and migration, so a branch that changes them runs against its own Core and database, never the shared dev Neon branch.

1. **Database.** Create an empty local Postgres database and point `apps/core/.env` and `packages/database/.env` at it. On Postgres 14/15, `prisma migrate deploy` fails on an old migration; create the schema from the Prisma files instead: `CREATE EXTENSION pg_trgm;`, then apply `pnpm exec prisma migrate diff --from-empty --to-schema prisma --script` (from `packages/database`) with `psql`. Seed test accounts with `CLOUD_AGENT_DB_FORCE=1 node scripts/cloud-agent-db/seed-auth-fixtures.mjs` (`alice@sokosumi.test` and the others, password `Password123!`).
2. **Core and Web.** Core's `.env` needs `SOKO_BOT_ENABLED="true"`, `SOKO_BOT_RUNTIME_ADAPTER="in-process"` and an `AI_GATEWAY_API_KEY`, with `BETTER_AUTH_URL` and `WEB_APP_BASE_URL` on your local ports. Web needs Node 24 and `CORE_APP_BASE_URL` / `NEXT_PUBLIC_CORE_APP_BASE_URL` on that Core.
3. **CMO's OAuth client.** Signed in as a test account, `POST {core}/auth/oauth2/create-client` with `token_endpoint_auth_method: "client_secret_basic"`, `grant_types: ["authorization_code", "refresh_token"]` and `scope: "openid sokosumi:api offline_access"`. Better Auth only registers `https` redirect URIs on non-loopback hosts for web clients, so register a placeholder, then set the real callback on the row in your local database: `UPDATE "oauthClient" SET "skipConsent" = true, "redirectUris" = ARRAY['http://localhost:<cmo port>/api/auth/callback/sokosumi'] WHERE "clientId" = '<client_id>';` (authorize matches the URI exactly).
4. **CMO.** `apps/cmo/.env.local` holds `BETTER_AUTH_URL` (CMO's origin), a random `BETTER_AUTH_SECRET`, `CORE_APP_BASE_URL`, and the client's `SOKOSUMI_OAUTH_CLIENT_ID` / `SOKOSUMI_OAUTH_CLIENT_SECRET`. Start it with `PORT=<cmo port> pnpm dev`.

The in-process runtime has no sandbox, but it runs Cuso's read-only web tools (`web_search` through the AI Gateway, `web_fetch`) itself, so Cuso reads the real site locally too. Shell and workspace tools stay sandbox only.

To run a CMO rhythm now instead of waiting for its schedule, move its `nextRunAt` into the past (`soko_bot_schedule.systemKey` is `cmo-daily-run` or `cmo-weekly-review`; the column is UTC) and call `GET {core}/sync/soko-bot-schedules` with `Authorization: Bearer <CRON_SECRET>`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
