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

- `mountView(id, { schema, isEmpty, empty, refreshTool, refreshArgs, displayModes, children })` connects to the host (`ui/initialize`), validates the tool result's `structuredContent` with `schema`, and shows a skeleton, the error state (error result, cancelled call, or a result the schema rejects), the empty state (`empty` names its text), or the view.
- `context.refresh()` re-runs `refreshTool` (the data twin) with the call's arguments, and `refreshArgs` over them, through the host (`tools/call`) and shows the new result; a failure keeps the last one. It is absent when the host offers no `serverTools` or never sent the arguments. When the server answers "Unknown tool" (the twin's toolset is off), `context.missingTool` names it, and the view says which toolset to add (SOKD-419). `context.refreshStatus` is the HTTP status on the last refresh's error result, until one succeeds.
- `refreshArgs` repeats the twin arguments the show tool always sends (`args` in Core's `ui-tools.ts`), such as the board's `includeDescription: "false"` (SOKD-496), so a refresh returns the same light result.
- `displayModes` declares the modes a view supports, such as `fullscreen`; `context.displayMode` and `context.availableDisplayModes` come from the host.
- A theme-only host-context change flips the view between light and dark. Check it with the harness's `&retheme`.
- `context.input` holds the tool call's arguments, such as the agent id the hire form calls tools with.
- `SchemaForm` (`src/shell/SchemaForm.tsx`) renders an agent's input schema (`input_data` or `input_groups`) as fields with inline errors, and returns Core's `inputData` (options as indices, as on Web). File fields send people to Sokosumi. Hosts sandbox views without `allow-forms`, so a `<form>` never submits: the button and Enter run the check instead.
- Theme: views use Sokosumi's own style, as on Web, in every host (ADR 0083 amendment, SOKD-475). Only light or dark follows the host's `theme`; its style variables and fonts are ignored. `tokens.css` holds Sokosumi's tokens, copied from `apps/web/src/app/globals.css`, and `tokens.test.ts` fails when they drift. Change a value in Web first, then here. Use Web's utility names (`bg-card-background`, `text-muted-foreground`, `bg-status-working`, ...).
- Font: `font.ts` loads the embedded Inter subset (`fonts/`) from bytes with `FontFace`; the spec's default CSP blocks `data:` fonts. The harness applies that CSP, and a screenshot fails when Inter did not load.
- Primitives: `ui.tsx` has Web's buttons (`PrimaryButton` for the one Iris action; `Button` with `outline`, `ghost` and `destructive`), `Badge`, `StateMessage` (Web's EmptyState) and a `Skeleton` per layout (`mountView`'s `skeleton`: `cards`, `detail` or `form`). `status.tsx` has Web's status marker and chip; `views/task.tsx` maps Task statuses onto it and adds the priority glyph, avatar and due badge. Glyphs come from `lucide-react`, as on Web; Social's brand marks are inline SVG copied from Web.
- Markdown: `Markdown.tsx` renders record Markdown (descriptions, comments, Job results and questions) as React elements: raw HTML stays text, images show their alt text, links open only under `webBaseUrl`.
- Size: the App reports its height to the host (`autoResize`).
- Text: every string goes through `t()` from `messages/en.json`. Dates go through `formatDateTime`, which uses the host's locale and time zone.
- Links: open only URLs that pass `isUnderBase(url, context.webBaseUrl)`, through `context.app.openLink`.
- A step only a person takes: an error result with `kind: "person_approval_required"` shows the shell's `approval` state, with "Review in Sokosumi" for its `details.webUrl` when that is under `webBaseUrl` (ADR 0077). No view has an approve control.
- Job input (SOKD-423): while a Job is `input_required`, the job-status view loads the question with `jobs_input_request`, renders it with `SchemaForm`, and answers with `jobs_input` and the request's `eventId`. Answering spends nothing, so the submit is its only confirm. Polling holds only while the answer is in flight, so an answer given elsewhere still shows.
- Task views share `src/views/task.tsx`: the assignee, initials, status words (`task.status.*`) and the Task's Web URL.

## Rules

- No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `dangerouslySetInnerHTML`. Biome fails on them here (`biome-plugins/no-raw-html.grit`). Record text renders as React text.
- No fetches, remote images, fonts or CSP domains. Data arrives only as tool results.
- No approve, publish, send or resume control (ADR 0077). A view that spends credits has its own two-step confirm.
- One Iris `PrimaryButton` per view; everything else is a neutral `Button`, and an irreversible confirm is `destructive`. Targets are at least 44px (`min-h-11`), focus is visible, and a view works from 320px.

## Commands

| Command                                      | Purpose                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm --filter @sokosumi/mcp-ui build`       | Build the views and the registry into `dist/`                                                 |
| `pnpm --filter @sokosumi/mcp-ui test`        | Vitest: shell against a fake host, tokens, build                                              |
| `pnpm --filter @sokosumi/mcp-ui typecheck`   | Typecheck                                                                                     |
| `pnpm --filter @sokosumi/mcp-ui harness`     | Host harness at `http://localhost:5173/?view=hello&fixture=default&theme=dark`                |
| `pnpm --filter @sokosumi/mcp-ui screenshots` | Playwright screenshots, light and dark, 320/402/768px and a theme switch, into `screenshots/` |

The harness and the screenshots read `dist/`, so build first. Fixtures live in `harness/fixtures.ts`; add one per state a view has. A fixture's `host` sets host context such as `displayMode`; the `default` and `fullscreen` fixtures, and any with `allWidths`, are shot at every width. `calls` answers the view's `tools/call` by tool name (a result, `"pending"` or `"fail"`; `false` offers no `serverTools`), and `play` fills fields and clicks buttons before the shot, for states such as confirm and submitting. Set `PLAYWRIGHT_CHANNEL=chrome` when Playwright's own browser is not downloaded.
