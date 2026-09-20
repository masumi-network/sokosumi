# ADR 0002: TUI-first CLI slice boundaries

- Status: Sequencing superseded on 2026-09-18 by ADR 0004; separate-change boundaries retained
- Date: 2026-09-15

[VERIFIED] Linear SOK-1139 (Todo; supersedes canceled SOK-1069) is the current minimal TUI implementation issue under SOK-909. Its scope excludes Coworker onboarding, Core API/data-contract changes, runtime adapters, and chat. SOK-966, SOK-967, and SOK-950 remain separate CLI/Core work.

[DECISION, user-approved 2026-09-15] Finish SOK-1069/T27 before adding workspace connection, runtime adapter, Agent-developer, or Agent-to-Coworker promotion behavior. Later work must land as separate small vertical PRs. SOK-1069 was canceled and superseded by SOK-1139 on 2026-09-20; treat the decision below as historical sequencing, not current execution guidance.
Later workspace connection, runtime adapter, Agent-developer, and Agent-to-Coworker designs remain open and are not decided here.

## Correction on 2026-09-18

[REPORTED: user decision] TUI changes are paused. Completing T27 is no longer a prerequisite for Coworker integration. The earlier sequencing decision above is retained as history, not current execution guidance. [ADR 0004](0004-coworker-capabilities-and-graduation.md) records optional capabilities, runtime lifetimes, and paid graduation. TUI and Core changes still require separate reviewable implementation slices.

## Consequences

- Current TUI changes remain reviewable without mixing Core or web product changes.
- Existing headless Agent, Coworker, Task, and Job commands remain unchanged.
- The accepted outbound-first runtime decision remains in [ADR 0003](./0003-outbound-first-coworker-runtime-adapters.md); this ADR only defines delivery boundaries for the current CLI slice.