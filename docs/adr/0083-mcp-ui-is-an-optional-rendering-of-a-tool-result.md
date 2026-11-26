# MCP UI is an optional rendering of a tool result

- Status: Accepted
- Date: 2026-11-25

People who use Sokosumi from Claude.ai, Claude Desktop and mobile, or ChatGPT see raw JSON for every tool result. SOKD-413 adds interactive views for the main workflows: the Task board, the hire form, Job status, Task detail, the agent browser and Social posts waiting for approval. A view is an optional rendering of a result an MCP tool already returns. It adds no operation, and a client that cannot render it loses nothing.

**Why:** The MCP server already covers every operation ([ADR 0076](0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md), `docs/agents/agent-surface.md`). What is missing is something a person can read and click. A view that only renders keeps one source of truth for data and rules: the `/v1` route behind the tool.

## Decisions

- **Standard: MCP Apps.** The extension `io.modelcontextprotocol/ui` (SEP-1865, specification 2026-01-26), which Claude and ChatGPT both implement. A tool links a view through `_meta.ui.resourceUri`; the view is a `ui://` resource with MIME type `text/html;profile=mcp-app`, rendered by the host in a sandboxed iframe.
- **Views are single-file HTML served by Core.** Core answers `resources/list` and `resources/read` from the strings `packages/mcp-ui` exports. Nothing is fetched at render time.
- **Text fallback.** A UI tool's result is a normal tool result: `content` text and `structuredContent`. A client that does not render views, such as Claude Code, shows that and works as before.
- **Separate "show" tools, each with a data twin.** A UI tool is a row in `MCP_UI_TOOLS` (`apps/core/src/lib/sokosumi-mcp/ui-tools.ts`): `name`, the data twin's name, the view's id and a `description`. It takes the twin's input schema, annotations and toolset, runs the twin, and returns the twin's exact result plus `_meta.ui.resourceUri`. UI is never attached to an existing data tool. The agent calls a show tool when the person should see something, and the data tool when it only needs the data.
- **A view may spend credits after its own two-step confirm.** The hire form calls the hire tool only after a confirm step that shows the agent, the workspace, the price as Core returned it and the balance. The call sends `maxCredits` equal to the shown price, so a price change fails instead of charging more, and the button disables on submit. Claude shows no host prompt for a tool call a view makes, so the view's confirm is the person's check. Spending credits is already open to agents ([ADR 0077](0077-agents-draft-and-stop-a-person-publishes-sends-and-starts-ad-spend.md)).
- **No remote images in v1.** Views show initials and text instead of avatars, logos and post images. Remote images need CSP domains and tell the image host when a view opens.
- **ADR 0077 holds inside views.** No view has an approve, reject, publish, send or resume control. "Review in Sokosumi" opens the item's Web link through `ui/open-link`, and only for URLs under the `webBaseUrl` that Core puts on the result (`_meta.sokosumi.webBaseUrl`). Cancel and stop stay in the view, behind a confirm, as ADR 0077 allows for agents.
- **Security rules for every view:**
  - The view never fetches Core and never holds a token. Data arrives as tool results through the host, on the connection the person already signed in with.
  - No CSP domains: the resource declares no `connectDomains` or `resourceDomains`.
  - No `innerHTML` or `dangerouslySetInnerHTML` (a Biome error in the package). Record text such as Task names, comments and post copy renders as plain text.
  - `ui/message` and `ui/update-model-context` send ids and fixed templates only, never record text, so text written by someone else cannot reach the model as the person's words.
  - No app-only tools. A view calls only tools the agent can also see and call.
- **The package contract.** `packages/mcp-ui` (`@sokosumi/mcp-ui`) has one directory per view and a generated registry that exports `MCP_UI: Record<UiId, { uri, html }>`, both strings. Views use React 19, Tailwind v4 and Vite's single-file build; strings are English at launch, behind `t()`.
- **Hashed URIs.** A view's URI is `ui://sokosumi/<id>.<hash8>.html`, where the hash is of its HTML, so a host's cache never shows a stale view after a deploy. Core resolves a URI by its id, so an old hash still reads the current HTML and an old conversation keeps rendering. Core does not set `_meta.ui.domain`, because `?toolsets=` changes the server URL a host would derive the domain from.

## Considered options

- **UI on the existing data tools.** No new tools, but every `tasks_list` an agent makes for its own work would render a board in the chat, and every client would get a changed result. Rejected: the agent should choose when the person sees a view.
- **Embed Sokosumi Web in an iframe.** Reuses the real screens, but needs a Web session inside a third-party sandboxed frame, a second sign-in and CSP frame exceptions, and it would put Web's approve, publish and send buttons inside an agent's host. Rejected.
- **An approval grant minted over MCP,** so a view could approve a post or send a newsletter. Rejected: the host sends a view's tool calls over the same MCP token the agent uses, so Core cannot tell a person's click from the agent's call. Anything a view can approve, the agent can approve. ADR 0077's person check stays a Sokosumi browser session.

## Consequences

- UI tools need no manifest row and no CLI command: they add no operation. `docs/agents/agent-surface.md` says so.
- UI tools sit in their twin's toolset, so a show tool in a default toolset counts toward the default `tools/list` limit.
- Each view keeps its own confirm for credits; a missing confirm is a review blocker, because nothing else asks the person.
- Images wait for a later ADR that decides which hosts a view may load from.
- Follow-up tickets under SOKD-413: the package, build, shell and host harness (SOKD-415), then Core serving `ui://` resources (SOKD-416), then the views in waves, starting with the Task board.

## Amendment 2026-11-26: Sokosumi's style in every host (SOKD-475)

Owner decision: views look like Web, as Web looks, in every host. In Claude and ChatGPT they had taken the host's font and colours and read as generic host UI.

- **Theme.** Only light or dark follows the host's `theme` (else the system's). The host's style variables and fonts are ignored. Colours are Sokosumi's tokens from `apps/web/src/app/globals.css`, which `tokens.test.ts` keeps in sync.
- **Font.** Inter, Web's font, is embedded in each view as a 26 KB subset and loaded from bytes with `FontFace`. The spec's default CSP has no `font-src`, which blocks an `@font-face` with a `data:` URL; bytes are not a fetch. Still no remote font and no CSP domain.
- **Markdown.** Task descriptions and comments, Job results and Job input questions render as Markdown, as on Web, by a small renderer in the package that builds React elements only. Raw HTML stays text, images show their alt text, and a link opens only under `webBaseUrl`. This replaces "record text renders as plain text" for those fields. A parser library would cost 55 to 80 KB of the 600 KB budget.

## Amendment 2026-11-26: a show tool may fix twin arguments (SOKD-496)

The team board failed in Claude.ai and ChatGPT: utxo's 100 newest Tasks came to 2.6 MB with descriptions (text plus `structuredContent`), and the board shows none. The 53-Task personal board, 725 KB, rendered in both.

- A row in `MCP_UI_TOOLS` may set `args`: twin arguments the show tool always sends, over the agent's. The result is still the twin's exact result for the arguments sent, so a client without views sees what `tasks_list` would answer for them.
- `tasks_show_board` sends `includeDescription: "false"`, a `GET /tasks` argument that sends each `description` as null. The item shape stays the same, so Web and the generated client are unaffected.
- The view repeats `args` on refresh (`refreshArgs` in `mountView`), so a refresh is as light as the first result.
- Rejected: a smaller page alone (descriptions are unbounded, so the page stays heavy) and a show tool that trims the result itself (no longer the twin's result).

## Sources

- MCP Apps overview: https://modelcontextprotocol.io/extensions/apps/overview
- MCP Apps specification 2026-01-26: https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/main/specification/2026-01-26/apps.mdx
- Claude, MCP Apps getting started: https://claude.com/docs/connectors/building/mcp-apps/getting-started
- Claude, app tools: https://claude.com/docs/connectors/building/mcp-apps/app-tools
- ChatGPT, MCP Apps in ChatGPT: https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
