# Hermes Preprod pilot

[REPORTED: user request, 2026-09-27] Prepare one complete Task test for tomorrow, without changing Core.

[REPORTED: Preprod pilot run by `/root`, 2026-09-27] Admin provisioning and developer Workspace connection reached `GRANTED`. Existing membership was reused. The paid pilot organization had no unused Seats, and the inspected member had no Seat assigned. See the [reported setup fields](agent-runtime-pilot.md#observed-setup-2026-09-27). No live Hermes or Task runtime was tested.

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`, `apps/cli/src/coworker/runtime-task.ts`] `runtime run` starts and completes one assigned Task through the existing Hermes profile. It uses a `coworker_*` key on Preprod. It does not read developer credentials. These are source checks, not live proof.

[REPORTED: user clarification, 2026-09-27] Developers choose where their agent runs. Their cloud environment and their own hardware are both valid deployment locations. Host selection is not a product prerequisite.

[CORRECTION, VERIFIED: `apps/cli/src/coworker/hermes-runtime.ts`, `apps/cli/src/cli/index.ts`, `apps/cli/src/cli/commands/runtime.ts`] The earlier same-machine description combined two separate requirements. The runtime adapter runs beside Hermes. The developer CLI can run elsewhere. Runtime commands use a Coworker key from their scoped OS-vault entry or stdin and bypass developer login. The pipelines below show the optional case where both commands run on one machine. Cross-host key delivery is not implemented by this CLI.

## Before the test

1. On the developer's agent host, provide the CLI and a compatible Hermes executable with outbound access to Preprod.
2. Use the developer's existing Hermes home and working directory. Confirm that this profile can perform the test Task.
3. Follow the [setup discovery and identity checks](agent-runtime-pilot.md#1-prepare-one-assigned-task). Connect the provisioned Coworker and check Task Seat eligibility.
4. Resolve any Seat blocker, then create a small Task with the CLI Workspace flag below. Assign the Coworker and set `READY`.

[VERIFIED: `apps/cli/src/coworker/hermes-runtime.ts`] Preflight checks the executable version and required help flags before reading the Coworker key. Hermes receives Task name and description through stdin. The adapter limits execution to ten turns and five minutes by default. The maximum configurable timeout is ten minutes.

[VERIFIED: `apps/cli/src/coworker/hermes-runtime.ts:55`] The child receives a limited environment. With an explicit `--provider`, it inherits only the matching provider key: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`. Without that override, no provider keys pass from the parent shell. Other shell-exported tool credentials do not pass through. Configure those credentials through Hermes's own supported setup, or use the [generic runtime commands](agent-runtime-pilot.md) from the existing agent. Preflight checks the executable interface; it does not test provider or tool authentication.

[CORRECTION, VERIFIED: `apps/cli/src/coworker/hermes-runtime.ts`; REPORTED: earlier upstream review, [Hermes startup](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/hermes_cli/main.py), [profile resolution](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/hermes_cli/profiles.py)] The first adapter relied on `HERMES_HOME` alone. Hermes can override an ordinary home through its saved active profile. The adapter now selects `--profile default` for ordinary homes and preserves explicit named-profile paths. Path normalization is identical for selection and the child environment.

[CORRECTION, REPORTED: existing-agent requirement in `apps/cli/SPEC.md`; official-source review by `/root/hermes_runtime_contract`, 2026-09-27] The first pilot forced safe mode and text-only work. That skipped the developer's agent configuration, including its web providers. The integration must use the selected existing profile. A new one-shot Task session is sufficient; attaching to a running conversation is not required. Actual tool availability still depends on that profile and is not proven by local fixtures.

[VERIFIED: `apps/cli/SPEC.md`, V77-V78; ADR 0004] This pilot is for a trusted private runtime. Profile tools have the access allowed by the developer's OS account and configuration. Keeping the adapter's key outside the child environment does not isolate the filesystem or prevent access to other credentials already available to that account. Public paid runtime isolation remains separate work.

## Build and inspect

[VERIFIED: `apps/cli/package.json`, `apps/cli/src/cli/index.ts`] Run these commands from the repository root. They build local CLI output and show its help.

```sh
pnpm build --filter=@sokosumi/cli --cache=local:w
node apps/cli/dist/bin/sokosumi.js runtime --help
```

## Run one Task

[VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/commands/runtime.ts`] The following pipeline creates a runtime key through developer authentication. It passes that key directly to the runtime through stdin. The runtime accepts the existing `coworkers api-key --json` response. Each pipeline invocation creates another key; use an existing secure key reader instead when a key is already retained in your vault.

[REPORTED: source review by `/root/cli_setup_progress`, 2026-09-27; Core `apps/core/src/routes/v1/coworkers/[id]/api-keys/post.ts:85`] Without an explicit expiry, the server key remains valid after this process exits. The pipeline can mint a key even if Hermes preflight then fails. Use the expiry option below and review unused keys through existing key management. In-memory handling does not revoke a server key.

Set these non-secret shell variables to the approved pilot values: `PILOT_COWORKER_ID`, `PILOT_VENDOR_ID`, `PILOT_ORGANIZATION_ID`, `PILOT_WORKSPACE_SLUG`, `PILOT_TASK_ID`, `PILOT_HERMES_DIR`, `PILOT_WORK_DIR`, and `PILOT_KEY_EXPIRES_AT`. Use absolute paths for both directories. Set a reviewed ISO expiry after the test window. The Hermes profile supplies the provider and model unless the operator passes explicit overrides.

[VERIFIED: `apps/cli/src/cli/auth-whoami.ts`, `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/commands/workspaces.ts`] These commands verify the developer's identity, connect the provisioned Coworker, and check Task Seat eligibility. `auth status` does not replace the live identity check. Before switching browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN` from the shell. These credentials override saved OAuth credentials. Switch the actual browser Web session before CLI login. CLI logout does not change that browser session.

Run these setup commands where the developer uses the CLI. That does not need to be the agent host.

```sh
node apps/cli/dist/bin/sokosumi.js --preprod auth login
node apps/cli/dist/bin/sokosumi.js --preprod auth whoami --json
node apps/cli/dist/bin/sokosumi.js --preprod workspaces list --json
node apps/cli/dist/bin/sokosumi.js --preprod coworkers connect \
  "$PILOT_COWORKER_ID" --vendor-id "$PILOT_VENDOR_ID" \
  --workspace-id "$PILOT_ORGANIZATION_ID" --json
node apps/cli/dist/bin/sokosumi.js --preprod workspaces check \
  "$PILOT_ORGANIZATION_ID" --json
```

Require the intended developer identity, `GRANTED`, and `taskSeatEligible: true` before creating the Task. Seat eligibility does not verify credits or runtime readiness. If false, ask the organization owner or admin to resolve it. `connect` does not assign a Seat or run this check.

[CORRECTION, VERIFIED: `apps/cli/src/cli/commands/coworkers.ts`, `apps/cli/src/cli/commands/runtime.ts`] Seat availability does not gate Coworker provisioning, connection, or operator key preparation. Finish those setup steps while the developer handles subscriptions in Web. Keep the Seat check before creating or running the organization Task.

[CORRECTION, VERIFIED: `apps/cli/src/cli/index.ts`, `apps/cli/src/api/http-client.ts`; Core `apps/core/src/middleware/organization.ts:166`] The earlier guide used Web for Task creation. The CLI now accepts the selected organization's slug on every `tasks` command. Set `PILOT_WORKSPACE_SLUG` from `workspaces list`. OAuth defaults to the personal Workspace without this flag. Core authorizes the selected Workspace.

After resolving the Seat check, create one approved Task. Copy the returned Task ID into `PILOT_TASK_ID`.

```sh
node apps/cli/dist/bin/sokosumi.js --preprod tasks create \
  --organization-slug "$PILOT_WORKSPACE_SLUG" \
  --coworker-id "$PILOT_COWORKER_ID" \
  --name "Hackathon pilot" --description "Reply with a short test result." \
  --status READY --json
```

[VERIFIED: `apps/cli/src/cli/commands/runtime.ts`] Run `runtime run` on the agent host. Supply the Coworker key through stdin using the operator's secure delivery method. Developer credentials are not required there. The following pipeline is an example for a shared machine; it does not perform remote delivery.

```sh
set +x
set -o pipefail
node apps/cli/dist/bin/sokosumi.js --preprod coworkers api-key \
  "$PILOT_COWORKER_ID" --api-key-name hackathon-task-pilot \
  --api-key-expires-at "$PILOT_KEY_EXPIRES_AT" --json |
node apps/cli/dist/bin/sokosumi.js runtime run "$PILOT_TASK_ID" \
  --coworker-id "$PILOT_COWORKER_ID" \
  --organization-id "$PILOT_ORGANIZATION_ID" \
  --hermes-home "$PILOT_HERMES_DIR" \
  --runtime-directory "$PILOT_WORK_DIR" \
  --api-key-stdin --json
```

[VERIFIED: `apps/cli/src/coworker/runtime-task.ts`] The runtime checks the Coworker and Task, writes `RUNNING`, invokes Hermes, then checks the assignment and status again. It posts `COMPLETED` with the actual answer. Success output contains the Task ID and completion event ID. The runtime does not poll for more work or retry a Task.

[VERIFIED: Core `apps/core/src/routes/v1/tasks/[id]/events/post.ts:468`, `apps/core/src/helpers/task-event-charge.ts:46`, `apps/core/src/helpers/task.ts:155`] Correction: Core does guard writes against the status read inside that request. The earlier draft incorrectly called all Core writes unguarded. There is no caller-supplied expected-status condition or worker lease. A status change after the CLI read but before Core reads the POST can still race with this command. Run only one executor for the Task.

## Recovery

[VERIFIED: `apps/cli/src/coworker/runtime-task.ts`] If execution or a write fails, inspect the Task and its events before any retry. The Task can remain `RUNNING`. A failed response does not prove that Core rejected the write. The command stops without changing a cancellation or retrying the Task.

```sh
node apps/cli/dist/bin/sokosumi.js --preprod tasks get "$PILOT_TASK_ID" \
  --organization-slug "$PILOT_WORKSPACE_SLUG" --json
node apps/cli/dist/bin/sokosumi.js --preprod tasks events "$PILOT_TASK_ID" \
  --organization-slug "$PILOT_WORKSPACE_SLUG" --json
```

## Verification limits

[VERIFIED: `apps/cli/test/cli/runtime.test.ts`, `apps/cli/test/coworker/hermes-runtime.test.ts`] The tests include a real subprocess fixture through CLI dispatch. They exercise profile selection, environment filtering, cancellation, bounded output, and final-result parsing. They do not use a live Hermes installation, model provider, or Core account.

## Least confident decisions

1. [VERIFIED: `apps/cli/src/coworker/hermes-runtime.ts`; INFERRED compatibility limit] Compatibility depends on the developer's Hermes version and provider configuration. Local fixtures cannot prove that installation works. The developer chooses its location.
2. [INFERRED: current Core authorization and separate Workspace discussion] Workspace isolation requires a separate decision before a wider hackathon rollout. This runtime uses the assigned Task route; it does not constrain every route available to a Coworker key.
