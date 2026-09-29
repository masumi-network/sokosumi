# ADR 0005: Coworker runtime identity and invocation contract

- Status: Accepted
- Date: 2026-09-21
- Decision source: user approvals in the SOK-967 grilling session
- Linear: SOK-967 (SPEC T29)
- Related: [ADR 0003](0003-outbound-first-coworker-runtime-adapters.md), [ADR 0004](0004-coworker-capabilities-and-graduation.md)

## Context

[VERIFIED] Developer CLI auth is OAuth and/or user API keys (`soko_*`). Reserved `coworker_*` keys are rejected as CLI login (`SPEC.md` V1, V6, V58). Core already mints Coworker API keys. SOK-1135 will mint a **developer** user API key after OAuth for headless CLI admin work; that key is not a runtime credential.

[PROPOSED in ADR 0004] A short-lived Core-issued “delegation” credential was a candidate runtime boundary. That choice needed approval before implementation.

## Decision

[REPORTED: user-approved, 2026-09-21]

### Actors and credentials

1. **Developer CLI** (interactive or headless) authenticates with OAuth and/or a user API key. Headless agents may call admin commands when those credentials are present. SOK-1135 mints the user API key after OAuth; it never authorizes Coworker runtime Core calls.
2. **Coworker runtime** authenticates only with a `coworker_*` API key. No developer OAuth or user API key fallback. No new short-lived developer-delegation JWT for T29.
3. **Actor type** is derived from credential class (`developer` vs `coworker`). Paths alone are not the source of truth.

### Session vs key

4. A **session grant** is separate from Coworker identity and from the `coworker_*` key material. Expiry or disconnect removes temporary authority. Identity and shared work history remain.
5. **Reconnect** requires authorization of a new session; it does not recreate the Coworker.
6. **Secret delivery**: session-only → in-process memory only; retained workspace-only and persistent hosted → OS vault under a Coworker-scoped entry. Secrets never appear in argv, model-visible output, logs, or non-secret config.

### Key administration

7. Mint, rotate, and revoke `coworker_*` only with developer credentials (OAuth or user API key), including headless CLI. The runtime must not self-mint.

### Invocation seams

8. CLI, TUI, and skills share **in-process** command handlers. Do not recursively invoke the CLI entrypoint (`runCli` / `sokosumi` subprocess) from TUI or adapters.
9. Runtime adapters call Core HTTP with `coworker_*`. Outbound-first connection remains as in ADR 0003.

### Public paid isolation

10. Public paid runtime operations must use `coworker_*`. Developer credentials are rejected for those operations. Core route enforcement lands with registration and paid slices; this ADR is the cited rule.

## Consequences

- T29 is closed as a contract: this ADR, SPEC amendments, and CLI-side actor/guard tests. No new Core session APIs in SOK-967.
- SOK-950 (T30) and later slices implement registration, session grants, and Core enforcement against this contract.
- ADR 0004’s “short-lived delegation credential” proposal is **rejected** for the current integration path; reopen only with a proven gap that `coworker_*` plus session grants cannot cover.

## Non-goals for this ADR

- Implementing Core session-grant endpoints.
- Implementing registration or secret vault wiring for runtimes.
- Changing SOK-1135 (developer user-key mint after OAuth).
