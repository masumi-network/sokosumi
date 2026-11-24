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

Coming with SOKD-367; until then the server lists every tool it has.

A toolset is one route group, such as `tasks` or `jobs`. By default the server will list `workspaces`, `users`, `tasks`, `jobs`, `agents` and `coworkers`. Pick others with `?toolsets=` on the URL:

```bash
claude mcp add --transport http sokosumi "https://api.sokosumi.com/mcp?toolsets=tasks,jobs"
```

An unknown toolset name is an error.

## For developers

- Route: `apps/core/src/routes/mcp/index.ts`. Tools: `MCP_TOOLS` in `apps/core/src/lib/sokosumi-mcp/tools.ts`. Adding a tool: [Agent surface](./agents/agent-surface.md#mcp-tools).
- The whole sign-in, from the first 401 to a tool call, is tested for a native (Claude Code) and a web (Claude.ai) client in `apps/core/src/routes/mcp/mcp-oauth.integration.test.ts`.
- Previews: `claude mcp add --transport http sokosumi <preview Core URL>/mcp`. Previews run live Turnstile, so a person signs in, not an agent.

Last updated: 2026-11-24
