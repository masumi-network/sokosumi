# Draft 3: MPS payment workflow in the bundled plugin

[REPORTED: user request, 2026-09-30] Finish CLI and plugin support for existing agents to accept MPS payments as Sokosumi Coworkers.

[PROPOSED] Status: Planned. Owner: coordinator. This document defines future work. This draft contains no payment implementation or live payment proof.

| Field | Proposed value |
| --- | --- |
| Draft PR title | `docs(cli): plan the MPS plugin workflow and payment proof` |
| Implementation title | `feat(cli): complete the MPS payment workflow in the bundled plugin` |
| Branch | `sok-1132-mps-plugin-flow` |
| Parent branch | `sok-1132-mps-paid-runtime` |
| Related work | SOK-909, SOK-1132, SOK-1214; receipt PR #5342 |

## Problem and intended behavior

[VERIFIED: source read at `2ec6554574d85b03845cca24ac87d3bc3992eea5`] The package resolves bundled Skills beside its executable. Evidence: `apps/cli/src/cli/commands/skills.ts:20-32`. The repository distribution guide states that installing Skill files does not install the CLI executable. Evidence: `apps/cli/skills/sokosumi/references/distribution.md:29`.

[VERIFIED: source read at the same commit] Runtime accepts `coworker_*` credentials and rejects redirects. Evidence: `apps/cli/src/api/http-client.ts:200-222`. Its credential store separates Coworkers within Preprod. Evidence: `apps/cli/src/coworker/runtime-credentials.ts:41-50`. These checks do not prove payment execution on an installed agent host.

[PROPOSED] An operator installs the CLI and loads its bundled Skill on a supported host. The agent discovers its Coworker setup and requests the customer's approval for paid work. It uses the approved runtime path from Draft 2 and reports the matching settlement receipt. The instructions cover recovery from interrupted commands.

## Requirements

1. [PROPOSED] The Skill must check the installed CLI's capabilities before suggesting payment commands. It must explain missing setup or an incompatible version. Do not assume another focused Skill is installed. Keep examples tied to the implemented command contract.
2. [PROPOSED] Keep operator setup and customer approval separate from runtime execution. Runtime uses only its Coworker credential. Task content or model output cannot grant spending authority. Keep credentials out of prompts, arguments, logs, and result files.
3. [PROPOSED] Payment messages must describe Core's authoritative state for the selected payment. Distinguish accepted funding, locked funds, delivered output, submitted result, settlement, and refund. Preserve unknown outcomes and service errors. Display the expected payout destination, amounts, and confirmed transaction when Core provides settlement proof.
4. [PROPOSED] Recovery instructions must preserve the accepted payment identifier. Read its current state before another write after interruption. Never replace an uncertain payment with a new quote automatically. Preserve delivered output when only seller submission needs recovery.
5. [PROPOSED] Complete a controlled Preprod payment from a clean supported host before enabling the finished flow for customers. Verify the customer debit and intended seller payout independently. Keep private own-workspace use free of automatic seller fees.

## Scope and reuse

[PROPOSED] Extend the existing CLI package and bundled Skill. CLI remains a Core HTTP client. Draft 2 owns payment authorization enforcement, settlement evidence, and refund accounting. This draft must not defer a missing payment safety check into user instructions.

| Proposed path | Planned change |
| --- | --- |
| `apps/cli/skills/sokosumi/SKILL.md` | Complete setup, approval, execution, receipt, and recovery instructions. |
| `apps/cli/skills/sokosumi/references/distribution.md` and `apps/cli/README.md` | Explain compatible installation and the tested host workflow. |
| `apps/cli/src/cli/commands/runtime.ts`, `discover.ts`, and `help.ts` | Describe supported payment operations and accurate outcomes. |
| `apps/cli/src/cli/commands/skills.ts` | Change only if a package test proves the current Skill lookup is insufficient. |
| `apps/cli/test/` | Verify installed package behavior, output contracts, credential isolation, and documented commands. |

[PROPOSED] Public listing, x402, new wallet custody, and untested framework adapters remain outside this PR. Publishing the package and deploying Core remain separate release actions. The first supported host and exact package version are open decisions.

## Test plan

[PROPOSED] Every row is Planned. No implementation test or paid host test has run for this draft.

| Test group | Cases and required evidence |
| --- | --- |
| Packaged installation | Install the built package in a clean directory. Run its executable and `skills path`. Load the returned Skill and its references. Confirm that the package contains no local credentials. Source-checkout success alone does not pass this group. |
| Instructions and output | Parse all documented commands with the built CLI. Exercise funded, pending, unknown, refunded, disputed, and settled responses. Verify one JSON document per command and stable nonzero errors for rejected operations. A successful read of an unsettled payment must not claim payment success. |
| Identity and authority | Test OS vault and operator-controlled stdin input. Reject developer credentials on runtime calls. Reject Task, Coworker, and network mismatches. Verify that instructions inside a Task cannot approve spending or expose credentials. |
| Recovery | Interrupt funding, execution, and result submission. Restart using the same payment identifier. Confirm that the agent inspects Core state before retrying and preserves completed output. Check database records for duplicate debit or refund compensation. |
| Controlled Preprod sale | Record installed package revision, host, Task, approved payment, customer debit, delivered output, and confirmed seller transaction. Match the payout address and asset amounts to the accepted quote. Repeat requests and confirm no second charge. A mock, `PURCHASED`, or Task completion alone does not pass. |

[PROPOSED] Run CLI tests, build, and typecheck for implementation changes. Run the repository documentation checks for command examples. Reuse Core integration tests from Draft 2; do not replace them with Skill text assertions.

## Acceptance and delivery

- [ ] [PROPOSED] Drafts 1 and 2 provide the approved payment contract and all money-handling checks.
- [ ] [PROPOSED] The installed executable finds its bundled Skill, and every documented payment command exists.
- [ ] [PROPOSED] The selected host completes the paid workflow with isolated Coworker credentials and correct recovery.
- [ ] [PROPOSED] A controlled Preprod run proves the customer debit, delivered result, and intended seller receipt.
- [ ] [PROPOSED] The PR records exact test output and explains each test's limits before readiness or release claims.

[PROPOSED] Keep this PR stacked on Draft 2. After the parent merges, rebase onto current `main`, retarget, and rerun checks. Merge remains a human action. Do not close SOK-1132 or SOK-1214 from document acceptance alone.

[OPEN] The funded test needs an approved Preprod Workspace, payer, Coworker, MPS seller, asset amounts, and spending ceiling. Verify Task Seat and credit readiness without purchasing capacity as a side effect. Preserve payment evidence without publishing credentials or private Task content.

## Least confident decisions

1. [OPEN] Which installed host proves the first release. Hermes is an existing adapter; other hosts need separate execution evidence.
2. [OPEN] The final command names and receipt fields depend on the contracts implemented in Drafts 1 and 2.
3. [OPEN] The specific Preprod payer, seller, limits, and node collection settings for the live proof.
