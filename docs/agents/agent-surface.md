# Agent surface

Required when you add, change, or remove a user-facing Core `/v1` operation, a CLI command, or an MCP tool.

Agents manage Sokosumi through the CLI (`apps/cli`, published as `@masumi_network/sokosumi`) and the MCP server Core hosts at `{Core origin}/mcp`. Every user-facing Core `/v1` operation ships on both. The manifests in `apps/core/agent-surface/` record the mapping, and CI fails when an operation is missing from them.

## Manifest

One file per route group: `apps/core/agent-surface/<group>.json`. The group is the first path segment, so `GET /tasks/{id}` belongs in `tasks.json`. Operation keys are `METHOD /path` as Core's OpenAPI document writes them: no `/v1` prefix, path parameters in braces.

```json
{
  "operations": {
    "GET /tasks": { "cli": "tasks list", "mcp": "tasks_list" },
    "POST /coworkers/{id}/api-keys": {
      "cli": "coworkers api-key",
      "mcp": false,
      "reason": "Mints a long-lived credential."
    }
  }
}
```

| Key                   | Meaning                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operations.*.cli`    | A `command` from `CLI_COMMAND_CATALOG` (`apps/cli/src/cli/commands/catalog.ts`), or `false`. A generic JSON command counts; bespoke commands are for human flows.                              |
| `operations.*.mcp`    | The MCP tool name, or `false`.                                                                                                                                                                 |
| `operations.*.reason` | One line saying why a surface is `false`. Required with `false`, and only then.                                                                                                                |
| `backlog`             | The wave Task that covers the group. Until it lands, unlisted operations pass and a row may leave `cli` out (pending). A row with a `cli` command always maps `mcp`. The wave deletes the key. |
| `excluded`            | One line saying why the whole group stays off the agent surface. Unlisted operations pass; listed rows still map both surfaces.                                                                |

A group sets `backlog` or `excluded`, not both. Several operations may map to one command when the command calls them all (`agents hire` reads the input schema, then creates the job).

**Naming.** The MCP tool name is the CLI command with spaces and hyphens replaced by `_`: `tasks list` → `tasks_list`, `coworkers api-key` → `coworkers_api_key`. When the command is named for something other than its operation's group, or calls several operations, the tool is `<group>_<verb>` for its one operation, where `<group>` is the route group of what it acts on: `auth whoami` → `users_get` for `GET /users/{id}`, `workspaces list` → `workspaces_list` for `GET /users/{id}/workspaces`. The name's first segment is the tool's toolset; a hyphenated group keeps its words (`image_studio_catalog` is in `image-studio`, listed in `HYPHENATED_TOOLSETS` in `tools.ts`).

## What may be `false`

- Credential minting: API keys, coworker keys, secrets.
- Machine callers: webhooks, provider callbacks, Web-server leases, runtime-only variants.
- Public or anonymous routes, share links, and invite flows a person completes in a browser.
- Payments, billing, and pricing.
- Responses that are not JSON (file bytes, CSV) when a JSON operation returns the same data: `jobs files` lists the file URLs, `transactions list` the ledger rows.
- The steps a person takes: approving a Coworker's or vendor's access to a workspace (deny and revoke stay open), approving, rejecting or publishing a Social post, approving, scheduling or sending a newsletter, resuming an ad campaign, and connecting a social or ad account ([ADR 0077](../adr/0077-agents-draft-and-stop-a-person-publishes-sends-and-starts-ad-spend.md)). The other writes on those routes (drafting or scheduling a Social post, ad campaign changes, image-studio generations) stay `false` with the same citation until that ADR's follow-up tickets open them.
- Binary or multipart uploads: the generic CLI runner and MCP tools send JSON only (`POST /coworkers/{id}/image`; a person sets the picture in the Web app).
- The admin back office: CLI only, `mcp: false`.
- Downloads that return file bytes (images, CSV, spreadsheets): the CLI and MCP carry JSON. An API key still reads them over HTTP.

"Nobody needs it yet" is not a reason. Leave the operation to the group's `backlog` instead.

## Checks

| Check        | Where                                                   | Fails when                                                                                                                                                                             |
| ------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completeness | `apps/core/src/routes/v1/agent-surface.openapi.test.ts` | An operation is unmapped outside a `backlog` or `excluded` group, a row or file names no served operation, a `cli` row leaves `mcp` out, `false` lacks a `reason`, or a key is unknown |
| CLI binding  | `apps/cli/test/cli/agent-surface.test.ts`               | A `cli` value is not in `CLI_COMMAND_CATALOG`, or a catalog `operation` is mapped to another command                                                                                   |
| MCP binding  | `apps/core/src/routes/v1/agent-surface.openapi.test.ts` | A manifest `mcp` value is not in `MCP_TOOLS` or calls another operation, a tool in `MCP_TOOLS` has no row, or its name starts with no route group                                      |
| CLI fixtures | `apps/cli/test/cli/agent-surface.test.ts`               | A `cli` row has no fixture, a fixture names no `cli` row, or the fixture's run fails, runs another command, or does not send the row's operation                                       |
| MCP fixtures | `apps/core/src/lib/sokosumi-mcp/tools.surface.test.ts`  | A tool has no fixture, or its fixture's `/v1` request is not the tool's operation                                                                                                      |

`apps/core/agent-surface/**` is part of the `cli` filter in `.github/js-paths-filter.yml` and an input of the CLI's `test` tasks in `turbo.json`, so a manifest change reruns the CLI check.

**Fixtures.** Each mapped command and tool gets a surface-test fixture in the same PR as its row. CLI fixtures are described under [CLI commands and fixtures](#cli-commands-and-fixtures). An MCP tool's fixture is the arguments an agent would send, in `FIXTURES` in `tools.surface.test.ts`; the test calls the tool through a real MCP client and checks the method and path of the `/v1` request it makes.

## CLI commands and fixtures

A row in `CLI_COMMAND_CATALOG` with an `operation` needs no handler: the CLI runs it generically.

```ts
{ command: "jobs events", usage: "JOB_ID", operation: "GET /jobs/{id}/events" }
```

Positionals fill the path parameters in order. `--query KEY=VALUE` (repeatable) adds query parameters, `--input-json` or `--input-file` sends a JSON object body (required for writes, refused for reads and for a row with `noBody: true`, such as `tasks pause-schedule`), and `--organization-slug` selects the Workspace. Any other option is an error. The command prints Core's JSON body as is. Write a bespoke handler only for a human flow.

CLI fixtures live in `apps/cli/test/cli/agent-surface.fixtures.ts`, keyed by the manifest operation:

```ts
"GET /jobs/{id}/events": { argv: ["--api-url", "https://fixture.invalid", "jobs", "events", "job-1"] },
```

The check runs `argv` through `runCli` with `fetch` mocked. Core answers from the shared fake `core` (unknown requests get `{ "data": [] }`); add a `response(request)` function when a command needs other data. Requests are written `METHOD /path` without `/v1` or the query. `stdin` feeds `--api-key-stdin`. A command that sends different operations by flag gets one fixture per operation (`workspaces list` and `workspaces list --personal`).

## MCP tools

Core serves MCP at `{Core origin}/mcp` (`apps/core/src/routes/mcp/index.ts`; tokens in [ADR 0076](../adr/0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md)). A tool is one row in `MCP_TOOLS` (`apps/core/src/lib/sokosumi-mcp/tools.ts`): `name`, `operation`, a `description` written for an agent, and `destructive: true` for a write that deletes or overwrites.

- **Input** comes from the operation's OpenAPI definition (`tool-schema.ts`): path and query parameters by name, the JSON body as `body`, and `workspace` (an organization slug, sent as `X-Organization-Slug`) on every tool. Name clashes fail the derivation.
- **Toolsets.** A tool's toolset is its name's first segment. A client picks toolsets with `?toolsets=` on the server URL, comma-separated (`/mcp?toolsets=tasks,jobs`); without it, the server lists `DEFAULT_TOOLSETS` in `tools.ts` (workspaces, tasks, jobs, agents, coworkers). An unknown toolset answers 400 naming it. Keep the default `tools/list` under 80 tools (`mcp.integration.test.ts` checks it); a new route group's tools go in a new toolset outside the default. The server `instructions` list the toolsets on and off and tell the agent to call `workspaces_list` first.
- **Annotations** come from the method: `GET` is read-only; `DELETE` is destructive unless the row says otherwise. A row with `spendsCredits: true` (`agents_hire`) is destructive and open-world, so clients ask the person first, and its description starts with "Spends workspace credits."
- **A call** runs the operation through `/v1` in process as the token's user (`dispatch.ts`), so every guard applies: a route that needs an interactive session answers 403. The caller is always a plain user: never the admin role, never first-party, no OAuth client id. Admin work stays on the CLI.
- **Results**: Core's `data` and `pagination` as `structuredContent`. A Core error is `isError` with `{status, kind, message, details}`; a 5xx gives a generic message and the request id.

## Production safety

An MCP tool that writes acts on whatever Core issued its token. MCP writes to mainnet fall under the same gate as CLI writes: follow **Production safety** in [`apps/cli/AGENTS.md`](../../apps/cli/AGENTS.md) and get an explicit `yes` first.

## Adding or changing an operation

1. Add or change the route ([Core route patterns](./core-route-patterns.md)).
2. Map it in its group's manifest, or confirm the group's `backlog` or `excluded` covers it.
3. Add the CLI command and the MCP tool the row names, each with its fixture.
4. Run the checks:

   ```bash
   pnpm exec turbo run test --filter=@sokosumi/core -- src/routes/v1/agent-surface.openapi.test.ts src/lib/sokosumi-mcp/tools.surface.test.ts
   pnpm exec turbo run test --filter=@masumi_network/sokosumi
   ```

Removing an operation deletes its row in the same PR; the completeness check fails on the stale row. The wave that removes the last `backlog` key also deletes `backlog` support from the check and this page.
