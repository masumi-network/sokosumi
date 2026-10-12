# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (live glossary). Root `CONTEXT.md` is a symlink kept for old citations; edit `GLOSSARY.md`. A project's `CONTEXT.md` is unrelated product memory.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

`/grill-with-docs` extends these when new terms or decisions land. They already exist; read them.

## File structure

This is a **single-context** repo: one shared domain language (jobs, agents, credits, seats, organizations) spans the whole monorepo, so there is one `GLOSSARY.md` and one `docs/adr/` at the root — not per app or package.

```
/
├── GLOSSARY.md                ← domain glossary
├── docs/adr/                  ← system-wide decisions
├── apps/
│   ├── web/
│   ├── core/
│   ├── cmo/
│   ├── apple/                 ← Native macOS + iOS; product intent in VISION.md
│   └── cli/                   ← Developer CLI; product intent in VISION.md
└── packages/
    └── core-client/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0043 (Soko Bot turns run in per-bot Vercel Sandboxes) — but worth reopening because…_
