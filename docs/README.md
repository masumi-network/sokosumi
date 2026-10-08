# Documentation

This directory contains documentation for the Sokosumi monorepo.

## Coworker integrators

- [`coworker/vendor-workspace-grants-api.md`](./coworker/vendor-workspace-grants-api.md) — Core API behavior for vendor workspace grants (`GRANT_PENDING`, delegated create, 403 kinds)
- [`coworker/coworker-workspace-access-api.md`](./coworker/coworker-workspace-access-api.md) — Coworker early access (per-workspace pilot grants for chat/tasks; orthogonal to VendorGrant)
- [`coworker/social-posts-api.md`](./coworker/social-posts-api.md) — Coworker REST and Soko Bot tools for draft, schedule, and publish on connected providers
- [`coworker-metadata.md`](./coworker-metadata.md) — Marketplace profile and Ready-To-Run offers JSON
- [`coworker/benchmarks/`](./coworker/benchmarks/) — coworker chat cold-start benchmark

## OAuth clients

- [`oauth-clients.md`](./oauth-clients.md) — Sign in with Sokosumi for third-party apps: endpoints, the `sokosumi:api` scope in three places, token lifetimes, 401 vs 403 `insufficient_scope`, finding the user's workspace

## Agent tooling

Root [`AGENTS.md`](../AGENTS.md) is the loading table and trigger list. Task-specific files live in [`agents/`](./agents/). Do not restate that list here.

## Soko Bot

- [`soko-bot/`](./soko-bot/) — sandbox loop, Core as the control plane, in-process as the eval adapter

## Project image studio

- [`image-studio/deployment.md`](./image-studio/deployment.md) — which project carries which key, branch-scoped preview setup, and deploy side effects

## Features

- [`features/task-tags.md`](./features/task-tags.md) — Core task-tag vocabulary, `/sync/task-tags` worker (50 queued + 200 historical), spend bounds, and production-log caution
- [`intelligent-files/implementation-plan.md`](./intelligent-files/implementation-plan.md) — shipped Files catalog (`FileResource` / `FileVersion` / `FileChunk`; Core Jev; `FILES_JEV_ENABLED` default `"true"`)

## Native tables

- [`native-tables.md`](./native-tables.md) — Files tables storage, Core API, bounds, and isolated `native_tables` verification

## Wayfinder

- [`wayfinder/x402-evm/PR2-SPEC.md`](./wayfinder/x402-evm/PR2-SPEC.md) — remaining x402/EVM implementer spec (`Job.paymentRail` / `JobX402Payment`); substrate [`adr/0001-x402-evm-payment-rail.md`](./adr/0001-x402-evm-payment-rail.md)

## Architecture decisions

- [`adr/`](./adr/) — accepted architecture decision records (`adr/superseded/` holds superseded records)
