# ADR 0003: Outbound-first Coworker runtime adapters

[VERIFIED] The Developer CLI assigns `coworker_*` credentials to the Coworker process and permits only Core HTTP access (`apps/cli/VISION.md:43-47`). Core exposes cursor-paginated Coworker Task-event polling at `GET /v1/coworkers/me/events` (`apps/core/src/routes/v1/coworkers/me/events/get.ts:22-25,68-110`).

[DECISION, user-approved 2026-09-14] Self-hosted Coworker runtime adapters connect outward to Core first, execute assigned Tasks, and coordinate child Jobs. Core remains authoritative for identity, policy, and Task and Job state.

[INFERRED] This choice avoids public ingress for device-hosted runtimes and supports reconnecting to durable work after an offline period. Direct public HTTPS invocation remains a later option for hosted runtimes because the current Coworker route index has no runtime callback (`apps/core/src/routes/v1/coworkers/index.ts:30-48`).
