# Documentation

This directory contains documentation for the Sokosumi monorepo.

## Coworker integrators

- [`coworker/vendor-workspace-grants-api.md`](./coworker/vendor-workspace-grants-api.md) — Core API behavior for vendor workspace grants (`GRANT_PENDING`, delegated create, 403 kinds)
- [`coworker/coworker-workspace-access-api.md`](./coworker/coworker-workspace-access-api.md) — Coworker early access (per-workspace pilot grants for chat/tasks; orthogonal to VendorGrant)
- [`coworker-metadata.md`](./coworker-metadata.md) — Marketplace profile and Ready-To-Run offers JSON
- [`coworker/benchmarks/`](./coworker/benchmarks/) — coworker chat cold-start benchmark

## Agent tooling

Root [`AGENTS.md`](../AGENTS.md) is the loading table. Task-specific instructions:

- [`agents/architecture.md`](./agents/architecture.md) — architecture, generated files, shared packages, Database Access
- [`agents/coding-conventions.md`](./agents/coding-conventions.md) — TypeScript, lint, tests
- [`agents/web-ui.md`](./agents/web-ui.md) — Web UI, styling, React conventions
- [`agents/local-development.md`](./agents/local-development.md) — install, env/DB, launch, browser verification
- [`agents/cloud-environment.md`](./agents/cloud-environment.md) — Cursor Cloud VM, local Postgres fallback
- [`agents/delivery.md`](./agents/delivery.md) — commits, CI, pull requests
- [`agents/skill-routing.md`](./agents/skill-routing.md) — skills, Linear, domain docs, Soko Bot
- [`agents/issue-tracker.md`](./agents/issue-tracker.md)
- [`agents/triage-labels.md`](./agents/triage-labels.md)
- [`agents/domain.md`](./agents/domain.md)
- [`agents/cloud-agent-database.md`](./agents/cloud-agent-database.md)

## Soko Bot

- [`soko-bot/`](./soko-bot/) — in-process Core runtime (deployment and operations)

## Wayfinder

- [`wayfinder/x402-evm/PR2-SPEC.md`](./wayfinder/x402-evm/PR2-SPEC.md) — remaining x402/EVM implementer spec (`Job.paymentRail` / `JobX402Payment`); substrate [`adr/0001-x402-evm-payment-rail.md`](./adr/0001-x402-evm-payment-rail.md)

## Architecture decisions

- [`adr/`](./adr/) — accepted architecture decision records (`adr/superseded/` holds superseded records)
