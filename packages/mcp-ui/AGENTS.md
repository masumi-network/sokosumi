# MCP UI Package Agent Guidelines

> **Purpose**: Package-specific guidelines for `@sokosumi/mcp-ui`. For monorepo-wide guidance, see the [root AGENTS.md](../../AGENTS.md).

## Package Overview

**Package Name**: `@sokosumi/mcp-ui`
**Purpose**: The MCP Apps views for Sokosumi's MCP server ([ADR 0083](../../docs/adr/0083-mcp-ui-is-an-optional-rendering-of-a-tool-result.md)). Each view renders one tool result inside a host (Claude, ChatGPT) in a sandboxed iframe.
**Stack**: React 19, Tailwind v4, Vite, `@modelcontextprotocol/ext-apps`.

## Contract

- `src/views/<id>/` holds one view: `index.html`, `main.tsx` (calls `mountView`) and its components.
- `pnpm --filter @sokosumi/mcp-ui build` (`scripts/build.ts`) builds each view into one self-contained HTML file, `dist/views/<id>.html`: inline JS and CSS, nothing fetched at render time. It writes the registry Core imports:

  ```ts
  import { MCP_UI, type UiId } from "@sokosumi/mcp-ui";
  MCP_UI.hello.uri; // "ui://sokosumi/hello.<hash8>.html", hashed from the HTML
  MCP_UI.hello.html;
  ```

- Every runtime dependency is bundled into the HTML, so the package has only dev dependencies. Core gets strings.

## The shell (`src/shell/`)

- `mountView(id, { schema, isEmpty, empty, refreshTool, displayModes, children })` connects to the host (`ui/initialize`), validates the tool result's `structuredContent` with `schema`, and shows a skeleton, the error state (error result, cancelled call, or a result the schema rejects), the empty state (`empty` names its text), or the view.
- `context.refresh()` re-runs `refreshTool` (the data twin) with the call's arguments through the host (`tools/call`) and shows the new result; a failure keeps the last one. It is absent when the host offers no `serverTools` or never sent the arguments.
- `displayModes` declares the modes a view supports, such as `fullscreen`; `context.displayMode` and `context.availableDisplayModes` come from the host.
- A theme-only host-context change keeps the style variables the host sent before: `light-dark()` values follow the new theme, fixed colours do not (SOKD-417). Check it with the harness's `&styles=fixed&retheme`.
- Theme: the host's `theme` and MCP Apps style variables (`--color-background-primary`, `--color-text-primary`, ...) win; `tokens.css` holds Sokosumi's fallbacks, copied from `apps/web/src/app/globals.css`. `tokens.test.ts` fails when they drift. Change a value in Web first, then here.
- Size: the App reports its height to the host (`autoResize`).
- Text: every string goes through `t()` from `messages/en.json`. Dates go through `formatDateTime`, which uses the host's locale and time zone.
- Links: open only URLs that pass `isUnderBase(url, context.webBaseUrl)`, through `context.app.openLink`.

## Rules

- No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `dangerouslySetInnerHTML`. Biome fails on them here (`biome-plugins/no-raw-html.grit`). Record text renders as React text.
- No fetches, remote images, fonts or CSP domains. Data arrives only as tool results.
- No approve, publish, send or resume control (ADR 0077). A view that spends credits has its own two-step confirm.
- One Iris `PrimaryButton` per view; everything else is neutral. Targets are at least 44px (`min-h-11`), focus is visible, and a view works from 320px.

## Commands

| Command                                      | Purpose                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm --filter @sokosumi/mcp-ui build`       | Build the views and the registry into `dist/`                                  |
| `pnpm --filter @sokosumi/mcp-ui test`        | Vitest: shell against a fake host, tokens, build                               |
| `pnpm --filter @sokosumi/mcp-ui typecheck`   | Typecheck                                                                      |
| `pnpm --filter @sokosumi/mcp-ui harness`     | Host harness at `http://localhost:5173/?view=hello&fixture=default&theme=dark` |
| `pnpm --filter @sokosumi/mcp-ui screenshots` | Playwright screenshots, light and dark, 320/402/768px, into `screenshots/`     |

The harness and the screenshots read `dist/`, so build first. Fixtures live in `harness/fixtures.ts`; add one per state a view has. A fixture's `host` sets host context such as `displayMode`; the `default` and `fullscreen` fixtures are shot at every width. Set `PLAYWRIGHT_CHANNEL=chrome` when Playwright's own browser is not downloaded.
