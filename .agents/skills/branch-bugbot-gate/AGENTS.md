# branch-bugbot-gate

Standalone PR finish gate: local verify → CI green → Bugbot 0 High → medium findings for human review.

## Load order

1. Read `SKILL.md`.
2. Load `QUALITY-RULES.md` when the diff matches R1–R12 triggers (optional self-check before Bugbot).

## Runtime notes

- Canonical files: `skills/branch-bugbot-gate/`.
- Install: `npx skills add . --skill branch-bugbot-gate` → `.agents/skills/branch-bugbot-gate/`.
- Load `.agents/skills/branch-bugbot-gate/` when present; otherwise `skills/branch-bugbot-gate/`.
- `disable-model-invocation: true` — run when `/implement`, poteto Opening a PR / Feature / Bug fix finish, or an explicit user ask names this gate.
- Do not attach to Cursor finish-menu button actions.

## Callers

| Flow | Hook |
|------|------|
| Ask Matt `/implement` | After `/code-review` + commits; ensure PR exists, then this skill |
| Poteto Opening a PR (and Feature / Bug fix / Refactoring that ends with it) | After PR URL exists; before claiming phase done |
| Manual | `/branch-bugbot-gate` or “run Bugbot gate on this PR” |
