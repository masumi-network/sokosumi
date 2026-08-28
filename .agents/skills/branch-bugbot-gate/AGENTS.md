# branch-bugbot-gate

Standalone PR finish gate: local verify → CI green → Bugbot 0 High → medium findings for human review.

## Load order

1. Read `SKILL.md`.
2. Load `QUALITY-RULES.md` when the diff matches R1–R12 triggers (optional self-check before Bugbot).

## Runtime notes

- Canonical files: `skills/branch-bugbot-gate/`.
- Install: `npx skills add . --skill branch-bugbot-gate` → `.agents/skills/branch-bugbot-gate/`.
- Load `.agents/skills/branch-bugbot-gate/` when present; otherwise `skills/branch-bugbot-gate/`.
- `disable-model-invocation: true` — run only when the user explicitly asks for this gate.
- Mentioned in root `AGENTS.md`; not hooked into `/implement` or poteto finish yet.
