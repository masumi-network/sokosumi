# Team Sapphire

Single-issue squad: Investigator → Tech Lead → Coder(s) → Reviewer.

## Load order

1. Read `SKILL.md`.
2. Read `PHASE-GATE.md` — blocking Linear writes per phase; exit verification.
3. Read `WORKFLOW.md`.
4. Read role file for the current phase: `INVESTIGATOR.md`, `TECH-LEAD.md`, `CODER.md`, or `REVIEWER.md`.
5. Read `SPEC-TEMPLATE.md` and `SUBAGENT-RUBRIC.md` before Tech Lead phase.
6. Read `LINEAR-MCP.md` before Linear writes.
7. Read `VISUAL-CAPTURE.md` before Reviewer phase (UI evidence).
8. Read `CURSOR-AUTOMATION.md` when configuring optional Linear-triggered Cloud Agents.

## Upstream

Requirement intake and approval: `../_task/SKILL.md`.

## Output rule

Keep specs concise. Tech Lead spec always includes a data flow diagram. Linear holds **Requirement + status** only — investigation and spec stay in session.

**Orchestrator:** Run all four phases in one session through **In Review**. Pass session artifacts phase to phase; do not write them to Linear. **Each phase must pass its gate** (`PHASE-GATE.md`) before the next phase starts.
