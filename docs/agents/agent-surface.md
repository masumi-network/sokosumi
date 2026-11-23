# Agent surface

Required when you add, change, or remove a user-facing Core `/v1` operation, a CLI command, or an MCP tool.

Agents manage Sokosumi through the CLI (`apps/cli`, published as `@masumi_network/sokosumi`) and the MCP server Core hosts at `{Core origin}/mcp`. Every user-facing Core `/v1` operation ships on both. The manifests in `apps/core/agent-surface/` record the mapping, and CI fails when an operation is missing from them.

## Manifest

One file per route group: `apps/core/agent-surface/<group>.json`. The group is the first path segment, so `GET /tasks/{id}` belongs in `tasks.json`. Operation keys are `METHOD /path` as Core's OpenAPI document writes them: no `/v1` prefix, path parameters in braces.

```json
{
  "backlog": "SOKD-369",
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

| Key                   | Meaning                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `operations.*.cli`    | A `command` from `CLI_COMMAND_CATALOG` (`apps/cli/src/cli/commands/discover.ts`), or `false`. A generic JSON command counts; bespoke commands are for human flows. |
| `operations.*.mcp`    | The MCP tool name, or `false`.                                                                                                                                     |
| `operations.*.reason` | One line saying why a surface is `false`. Required with `false`, and only then.                                                                                    |
| `backlog`             | The wave Task that covers the group. Until it lands, unlisted operations pass and a row may leave `cli` or `mcp` out (pending). The wave deletes the key.          |
| `excluded`            | One line saying why the whole group stays off the agent surface. Unlisted operations pass; listed rows still map both surfaces.                                    |

A group sets `backlog` or `excluded`, not both. Several operations may map to one command when the command calls them all (`agents hire` reads the input schema, then creates the job).

**Naming.** The MCP tool name is the CLI command with spaces and hyphens replaced by `_`: `tasks list` → `tasks_list`, `coworkers api-key` → `coworkers_api_key`.

## What may be `false`

- Credential minting: API keys, coworker keys, secrets.
- Machine callers: webhooks, provider callbacks, Web-server leases, runtime-only variants.
- Public or anonymous routes, share links, and invite flows a person completes in a browser.
- Payments, billing, and pricing.
- The steps a person takes: approving, rejecting or publishing a Social post, approving, scheduling or sending a newsletter, resuming an ad campaign, and connecting a social or ad account ([ADR 0077](../adr/0077-agents-draft-and-stop-a-person-publishes-sends-and-starts-ad-spend.md), proposed). The other writes on those routes (drafting or scheduling a Social post, ad campaign changes, image-studio generations) stay `false` with the same citation until that ADR's follow-up tickets open them.
- The admin back office: CLI only, `mcp: false`.

"Nobody needs it yet" is not a reason. Leave the operation to the group's `backlog` instead.

## Checks

| Check                    | Where                                                   | Fails when                                                                                                                                               |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completeness             | `apps/core/src/routes/v1/agent-surface.openapi.test.ts` | An operation is unmapped outside a `backlog` or `excluded` group, a row or file names no served operation, `false` lacks a `reason`, or a key is unknown |
| CLI binding              | `apps/cli/test/cli/agent-surface.test.ts`               | A `cli` value is not in `CLI_COMMAND_CATALOG`                                                                                                            |
| MCP binding and fixtures | Arrive with SOKD-366                                    | A manifest tool is not registered, or a tool has no fixture                                                                                              |
| CLI fixtures             | Arrive with SOKD-362                                    | A mapped command has no fixture that hits its operation                                                                                                  |

`apps/core/agent-surface/**` is part of the `cli` filter in `.github/js-paths-filter.yml` and an input of the CLI's `test` tasks in `turbo.json`, so a manifest change reruns the CLI check.

**Fixtures.** Each mapped command and tool gets a surface-test fixture in the same PR as its row. SOKD-362 (CLI) and SOKD-366 (MCP) add the fixture format and the checks above, and document it here.

## Production safety

An MCP tool that writes acts on whatever Core issued its token. MCP writes to mainnet fall under the same gate as CLI writes: follow **Production safety** in [`apps/cli/AGENTS.md`](../../apps/cli/AGENTS.md) and get an explicit `yes` first.

## Adding or changing an operation

1. Add or change the route ([Core route patterns](./core-route-patterns.md)).
2. Map it in its group's manifest, or confirm the group's `backlog` or `excluded` covers it.
3. Add the CLI command and the MCP tool the row names.
4. Run the checks:

   ```bash
   pnpm exec turbo run test --filter=@sokosumi/core -- src/routes/v1/agent-surface.openapi.test.ts
   pnpm exec turbo run test --filter=@masumi_network/sokosumi
   ```

Removing an operation deletes its row in the same PR; the completeness check fails on the stale row. The wave that removes the last `backlog` key also deletes `backlog` support from the check and this page.
