# ADR 0004: Optional capabilities and paid Coworker graduation

- Status: Accepted product direction; runtime and payment mechanisms remain proposed
- Date: 2026-09-18
- Decision source: user approvals in the developer CLI planning conversation
- Supersedes: ADR 0002's TUI-first sequencing requirement only

## Context

[REPORTED: user decision] Developers need brief local sessions, retained workspace-only Coworkers, and permanent hosted runtimes. They may connect solely to test eligibility. They need not complete capabilities in a fixed order or publish their Coworker.

[VERIFIED: source inspection at 63377d7] `apps/cli/SPEC.md` V1, V6, and V58 reject Coworker credentials in the developer CLI. Core registration is admin-only (`apps/core/src/routes/v1/coworkers/post.ts:75-132`). Global whitelist mutation is admin-only (`apps/core/src/routes/v1/coworkers/[id]/whitelist/patch.ts:42-55`). These are implementation facts, not capabilities delivered by this ADR.

## Alternatives

[INFERRED] A fixed graduation ladder would require unrelated capabilities from a Task-only or seller-only service. A universal framework plugin would hide differences between tool access and automatic runtime execution. A single readiness flag would become stale when grants, connection health, or payment configuration changed independently.

## Decision

[REPORTED: user-approved direction]

The developer CLI remains the admin control tool in `apps/cli`. A framework runtime acts as a registered Coworker. That Coworker may hire Masumi Agents. Keep developer and runtime identities separate. Do not create a second CLI product or turn the developer login into Coworker authentication.

Workspace registration, chat, Task/Job operations, x402 spending, and seller readiness are optional capability tracks. There is no mandatory order beyond actual dependencies. Both live-session tool use and automatic execution are goals; the latter requires a running worker.

A workspace must exist before registration. A developer chooses a Vendor they administer or explicitly creates one they control. Do not group unrelated developers into one shared Vendor. Session expiry removes temporary authority without deleting the Coworker identity or shared work history.

Private workspace use has no automatic seller usage fee. Model/provider bills and authorized purchases remain payable. A public paid Coworker charges customers under approved usage pricing. Developers submit pricing with the waitlist application. New public rates require review; existing authorized work retains its accepted version and spending limit.

Core owns grants, readiness policy, waitlisting, and administrative promotion. Masumi executes supported payment operations. A compatible x402 purchase can use workspace credits or a runtime-held wallet, with explicit funding selection and no silent fallback. The CLI does not become the payment backend.

Paid graduation requires valid safety and seller-payment checks plus tests for advertised capabilities. It does not require unrelated capabilities. Eligibility permits an application, not automatic promotion. Sokosumi administrators approve global availability after review. Global availability does not grant access to every workspace. Publishing a Masumi service is a separate action.

Derive live readiness from canonical owners. Store only non-derivable test evidence, bound to relevant configuration and validity. Do not copy access grants, health, and payment settings into competing authoritative records. Preserve approval history when a required check becomes invalid; block the affected service rather than treating historical approval as current payment readiness.

Public paid operation requires verified isolation from developer credentials. Private trusted sessions may share the developer's environment, but scoped tokens alone cannot isolate them. Runtime secrets must not reach argv, model-visible output, logs, or non-secret configuration.

## Consequences

[DECISION] ADR 0001 still governs the unchanged TUI. ADR 0003's outbound-first runtime direction remains accepted. T27 is deferred, not completed; external-prototype redesign is not a prerequisite for this work. Keep its historical requirement visible rather than silently rewriting it.

[DECISION] This documentation change does not implement capabilities, publish a package, modify Core, or select undocumented framework APIs. Existing commands and auth guards remain the current behavior. The [implementation plan](../developer-cli-implementation-plan.md) defines acceptance cases and contract prerequisites.

[VERIFIED: source inspection] `/coworkers/me/usage` accepts Coworker-reported credits and creates a debit (`apps/core/src/routes/v1/coworkers/me/usage/post.ts:91-200`). That is neither proof of customer-approved pricing nor proof of seller receipt. The public billing contract must bind usage to authorized work and pricing and verify settlement separately.

## Least confident decisions

1. [RESOLVED 2026-09-21 in ADR 0005] Runtime boundary = `coworker_*` API key plus a separate session grant. A short-lived Core-issued developer-delegation credential is **rejected** for the current path; reopen only if `coworker_*` plus session grants prove insufficient.
2. [PROPOSED] Local chat requires a transport and recovery contract. Existing task polling does not establish chat support.
3. [OPEN] Hosted Masumi tenancy, custody, seller fees, and payout provisioning require confirmation. No discussion or agreement with Sandro is claimed.
