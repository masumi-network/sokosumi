# Coworker API keys: list, create and revoke on the web and CLI

## Why

Replacing a leaked coworker key needed direct database access (2026-11-23).
Vendor admins should see and replace their coworkers' keys themselves.

## Decisions (2026-11-23)

- **Who:** the people Core already lets manage keys. That is vendor admins,
  developers assigned to the coworker, and platform admins (via the API). The
  web section sits on `/developer/coworkers/{id}`, which already admits vendor
  admins and assigned developers.
- **Replacing a key:** create, then switch the agent, then revoke. This takes
  two steps, so the agent has no downtime. There is no rotate button and no
  grace period.
- **CLI:** `coworkers list-api-keys COWORKER_ID` and
  `coworkers revoke-api-key COWORKER_ID KEY_ID` are generic catalog rows. The
  list command is not named `api-keys`, which would be one letter away from
  the mint command `api-key`. MCP stays pending under the group's backlog
  (SOKD-372).
- **Last used:** add `coworker_api_key.lastUsedAt`. Core writes it on auth at
  most once a minute, only when the stored value is older than 60 s.

## Slices

1. **Web section and CLI list/revoke.** No Core change: the four Core routes
   exist since #2488. Branch `feat/coworker-api-keys-web`.
2. **`lastUsedAt`.** This needs a migration, the throttled write in
   `apps/core/src/helpers/agent-api-key-auth.ts`, the field in
   `coworkerApiKeySchema`, a client regen, and a "Last used" column on the
   web. The migration must run under the previous release (see
   `packages/database/AGENTS.md`).
