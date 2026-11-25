# Sokosumi MCP server

Sokosumi serves its tools over MCP at `https://api.sokosumi.com/mcp`. An MCP client signs in with Sokosumi's own OAuth, then acts as the person who signed in. Tokens and registration rules are in [ADR 0076](./adr/0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md) and [OAuth clients](./oauth-clients.md#mcp-server).

## Connect

No API key or client setup is needed. The client registers itself, opens a browser to sign in, and asks you to approve access.

**Claude Code**

```bash
claude mcp add --transport http sokosumi https://api.sokosumi.com/mcp
```

Then run `/mcp` in Claude Code, pick `sokosumi` and sign in.

**Claude.ai**

Add a custom connector (in Claude.ai's settings, under Connectors) with the URL `https://api.sokosumi.com/mcp`, then connect it and sign in.

The consent page marks the client as unverified and shows where it sends you back to. That is expected for a client that registered itself.

## Scopes

The client asks for `openid sokosumi:mcp offline_access`.

| Scope            | Grants                                                    |
| ---------------- | --------------------------------------------------------- |
| `sokosumi:mcp`   | Calling the MCP server. Never Core `/v1`.                 |
| `openid`         | Who you are.                                              |
| `offline_access` | Staying signed in: the client refreshes its token itself. |

An MCP token lasts 15 minutes and works only at `/mcp`. A `/v1` token or API key does not work at `/mcp`. To revoke access, open **Connections → Authorized applications** in Sokosumi (`/connections`) and revoke the app. Its tokens stop working at the next request.

## Workspaces

Each tool acts in your personal workspace unless it gets a `workspace` argument: an organization workspace's slug. Call `workspaces_list` first to see the slugs you can use. The server's instructions tell the agent this.

## Toolsets

A toolset is one route group, such as `tasks` or `jobs`, or one feature of a large group, such as `task-schedules`. By default the server lists `workspaces`, `tasks` and `coworkers`: 34 tools. The marketplace is opt-in: to let the agent browse and hire agents and follow their Jobs, add `agents` and `jobs`, as in `?toolsets=workspaces,tasks,coworkers,agents,jobs`. Hiring an agent spends workspace credits. Without them, `tasks_jobs` still lists the Jobs that ran for a Task. Account tools are in `users`, which is opt-in: to let the agent check who is signed in (`users_get` with id `me`), preferences, files and the access granted to your personal workspace, add it, as in `?toolsets=workspaces,users,tasks`. The other opt-in toolsets include `projects`, `project-brand`, `social`, `ads`, `image-studio`, `newsletter`, `drive`, `transactions`, `history`, `notifications` and `categories`. Pick toolsets with `?toolsets=` on the URL. `projects` reads and manages Projects and their Calendar; `project-brand` holds the brand brain, competitors and strategies. `image-studio` reads the model catalog and Studio results, starts and cancels Image Studio generations, which spend credits, and edits what spends nothing: headlines, captions, Brand Kit, products and scripts. `social` drafts, plans and cancels Social posts, which wait for a person's approval. `newsletter` manages newsletter settings, subscribers and issues, and cancels a scheduled issue. `ads` edits the ads market profile, creates ad campaigns (always paused), pauses them, and changes the budget or edits a campaign only while it is paused. A person approves, publishes, sends and resumes an ad campaign ([ADR 0077](./adr/0077-agents-draft-and-stop-a-person-publishes-sends-and-starts-ad-spend.md)). `drive` searches, files and tags Drive documents and edits tables and data rooms; its tools take `scope` (`me`, or `org` with `organizationId`) instead of `workspace`, except the tables tools.

```bash
claude mcp add --transport http sokosumi "https://api.sokosumi.com/mcp?toolsets=workspaces,tasks,projects,social"
```

An unknown toolset name is an error.

### Toolsets changed (2026-11-25)

Large groups split into feature toolsets (SOKD-410). No tool was renamed; add the new names to `?toolsets=` to keep a tool you used:

| Toolset           | Tools                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `task-schedules`  | Task Schedules and their Runs (`tasks_*schedule*`); three of them spend credits                                               |
| `task-sharing`    | `tasks_join`, `tasks_leave`, `tasks_follow`, `tasks_unfollow`, `tasks_send_to_chat`, `tasks_workspace`, `tasks_set_workspace` |
| `task-views`      | `tasks_summary`, `tasks_view`, `tasks_set_view`, `tasks_move_overdue`, `tasks_undo_move_overdue`                              |
| `task-files`      | `tasks_files`, `tasks_upload_url`                                                                                             |
| `coworker-access` | Coworker API keys and workspace access: list, update and revoke                                                               |
| `project-brand`   | `projects_*` brand brain, competitor and strategy tools                                                                       |
| `social`          | `projects_social_*`                                                                                                           |
| `ads`             | `projects_ads_*`                                                                                                              |
| `image-studio`    | now also `projects_image_studio*`                                                                                             |
| `newsletter`      | now also `projects_newsletter_issue_cancel`                                                                                   |

`tasks` keeps everyday Task work: list, get, create, update, archive, restore, comment, events, Jobs, links, move and receipt.

## Views

Some tools have a view: an interactive rendering of their result inside the chat ([ADR 0083](./adr/0083-mcp-ui-is-an-optional-rendering-of-a-tool-result.md)). Claude.ai, Claude Desktop and mobile, and ChatGPT render views. Other clients, such as Claude Code, show the same result as text. A view tool returns exactly what its data tool returns and sits in that tool's toolset, so no setup is needed. Views show data and link to Sokosumi; approving, publishing and sending stay in Sokosumi.

## For developers

- Route: `apps/core/src/routes/mcp/index.ts`. Tools: `MCP_TOOLS` in `apps/core/src/lib/sokosumi-mcp/tools.ts`. Adding a tool: [Agent surface](./agents/agent-surface.md#mcp-tools).
- The whole sign-in, from the first 401 to a tool call, is tested for a native (Claude Code) and a web (Claude.ai) client in `apps/core/src/routes/mcp/mcp-oauth.integration.test.ts`.
- Views: `MCP_UI_TOOLS` in `apps/core/src/lib/sokosumi-mcp/ui-tools.ts`, HTML from `packages/mcp-ui`. Core serves each as a `ui://sokosumi/<id>.<hash8>.html` resource (`text/html;profile=mcp-app`) and resolves it by id, so an old hash reads the current HTML. No view ships yet; the Task board (SOKD-417) is first.
- Previews: `claude mcp add --transport http sokosumi <preview Core URL>/mcp`. Previews run live Turnstile, so a person signs in, not an agent.

Last updated: 2026-11-25
