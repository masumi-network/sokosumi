# Agent memory

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies. Several people work on this repo, and each one's agent memory (Claude Code, Codex, Cursor) is visible only to that person's own sessions. A lesson kept there helps one person; the same trap then costs every colleague again.

## Where a lesson goes

- **True for anyone on Sokosumi** (code, CI, deploys, tests, auth, tooling in this repo): the repo. Add it to the doc that owns the topic, as a short neutral rule with its reason, reached by a pointer from an `AGENTS.md` file (the `writing-for-agents` skill, `.agents/skills/writing-for-agents/`, has the style). Open a docs PR for it.
- **A decision and its reason**: an ADR in `docs/adr/`.
- **One person's machine, tools or preferences**: their agent memory.

Before writing, grep every `AGENTS.md` (root, `apps/*`, `packages/*`), `docs/`, `apps/*/docs/`, `.cursor/rules/` and `GLOSSARY.md`: if the repo already says it, write nothing. Leave out people's names, quotes and session history.

## Auditing an existing memory

Memories pile up team knowledge that never reached the repo. To move it, run this prompt in a Sokosumi checkout:

```text
Audit my private agent memory for this repo (Claude Code: ~/.claude/projects/<this repo>/memory/;
Codex/Cursor: my own memories, not files tracked in git). Read AGENTS.md and
docs/agents/agent-memory.md first. Files tracked in the repo (.cursor/rules/, AGENTS.md, docs/)
are shared documentation: never list them for deletion.

For each memory, sort it:
- Team knowledge (true for anyone on Sokosumi): check whether the repo already says it and
  whether it still holds against the current code. If it is new and true, add it to the
  matching doc as a short neutral rule with its reason: no names, quotes or session history.
- Decisions with a reason: check for an ADR; propose one if it's missing.
- Personal (my machine, my tools, my preferences): keep it in memory.
- Stale or duplicated: list it for deletion.

Show me the table (memory → outcome → target) before editing anything. If any repo change is
needed, open one draft docs PR with it, following docs/agents/delivery.md, and delete the
memory copies only after that PR has merged. Delete stale or duplicated memories once I
confirm, with or without a PR.
```

Each audit ends in a reviewed PR. #7375 is a worked example.
