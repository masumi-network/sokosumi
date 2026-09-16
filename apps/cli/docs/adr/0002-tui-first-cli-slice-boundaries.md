# ADR 0002: TUI-first CLI slice boundaries

- Status: Accepted
- Date: 2026-09-15

[VERIFIED] Linear SOK-1069 is the next implementation issue under SOK-909. Its scope excludes Coworker onboarding, Core API/data-contract changes, runtime adapters, and chat. SOK-966, SOK-967, and SOK-950 remain later CLI/Core work.

[DECISION, user-approved 2026-09-15] Finish SOK-1069/T27 before adding workspace connection, runtime adapter, Agent-developer, or Agent-to-Coworker promotion behavior. Later work must land as separate small vertical PRs.
Later workspace connection, runtime adapter, Agent-developer, and Agent-to-Coworker designs remain open and are not decided here.

## Consequences

- Current TUI changes remain reviewable without mixing Core or web product changes.
- Existing headless Agent, Coworker, Task, and Job commands remain unchanged.
- The accepted outbound-first runtime decision remains in [ADR 0003](./0003-outbound-first-coworker-runtime-adapters.md); this ADR only defines delivery boundaries for the current CLI slice.