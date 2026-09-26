# Documentation

This directory contains documentation for the Sokosumi monorepo.

## Coworker integrators

- [`coworker/vendor-workspace-grants-api.md`](./coworker/vendor-workspace-grants-api.md) — Core API behavior for vendor workspace grants (`GRANT_PENDING`, delegated create, 403 kinds)
- [`coworker/coworker-workspace-access-api.md`](./coworker/coworker-workspace-access-api.md) — Coworker early access (per-workspace pilot grants for chat/tasks; orthogonal to VendorGrant)
- [`coworker-metadata.md`](./coworker-metadata.md) — Marketplace profile and Ready-To-Run offers JSON
- [`coworker/benchmarks/`](./coworker/benchmarks/) — coworker chat cold-start benchmark

## Agent tooling

Root [`AGENTS.md`](../AGENTS.md) is the loading table and trigger list. Task-specific files live in [`agents/`](./agents/). Do not restate that list here.

## Soko Bot

- [`soko-bot/`](./soko-bot/) — in-process Core runtime (deployment and operations)

## Project image studio

- [`image-studio/deployment.md`](./image-studio/deployment.md) — which project carries which key, branch-scoped preview setup, and deploy side effects

## Wayfinder

- [`wayfinder/x402-evm/PR2-SPEC.md`](./wayfinder/x402-evm/PR2-SPEC.md) — remaining x402/EVM implementer spec (`Job.paymentRail` / `JobX402Payment`); substrate [`adr/0001-x402-evm-payment-rail.md`](./adr/0001-x402-evm-payment-rail.md)

## Architecture decisions

- [`adr/`](./adr/) — accepted architecture decision records (`adr/superseded/` holds superseded records)
