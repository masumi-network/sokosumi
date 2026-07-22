# Roles

Contracts only. Ops: `PHASE-CODER.md` / `PHASE-REVIEWER.md` / `PHASE-SEQUENTIAL.md`. **No Linear phase reporting.** Roles never call Linear MCP.

## Token shape

Caveman **full** in chat. **Not ultra** on Spec. Prefer `path:line` + short clause. Cap lists. Auto-clarity for security / irreversible / fragment ambiguity.

## Investigator

**Goal:** Codebase facts for Tech Lead — not a Spec.

**Do:** Search routes/services/schemas/tests; pitfalls (auth, web→core, migrations, generated, i18n); load `QUALITY-TRIGGERS.md` only — flag matching `Rn`; similar paths; open questions. `cavecrew-investigator` **only** for symbol locate (defs/callers/uses).

**Do not:** Contract tables, file-change lists, verification commands, mermaid, implement, rewrite Requirement, write Linear. Do not load `QUALITY-RULES`, `SPEC-TEMPLATE`, `SUBAGENT-RUBRIC`, `PHASE-*`, `VISUAL-CAPTURE`.

**Caps:** ≤12 patterns · ≤8 pitfalls · ≤5 recommend · ≤8 open · ≤5 related. ≤15 words/bullet (leading `path:line` / id / `` `symbol` `` excluded).

**Output:**

```markdown
## Investigation

**Patterns**
- `path:line` — `symbol` — why it matters

**Pitfalls**
- `path:line` — risk (Rn if trigger matches)

**Recommend** (optional)
- …

**Open** (Tech Lead must resolve)
- …

**Related**
- SOK-NNN — …
```

Omit empty sections. No essay preamble.

---

## Tech Lead

**Goal:** Implementable Spec from Requirement + Investigation.

**Do:** Resolve opens in **Key decisions**; always **Data flow**; `SUBAGENT-RUBRIC.md`; `QUALITY-TRIGGERS.md` then **only flagged** `QUALITY-RULES.md` sections (Spec appendix formats there); `[repo=masumi-network/sokosumi]` at top. List ≥1 path-only Verification route **iff** Deliverables include any of: `apps/web/src/app/**/page.tsx` or `layout.tsx`, `apps/web/src/components/**`, `apps/web/messages/**`. Never for generated client only (`apps/web/src/lib/clients/**`). Routes ⇒ **UI in scope**. If TDD required per `PHASE-CODER.md`, Verification **must** list the proving allowlisted test command — do not copy TDD globs here.

**Do not:** Implement; wait for human PRD approval; child issues; Spec on Linear; load `PHASE-*` or `VISUAL-CAPTURE`. Do **not** paste unused domain-pattern appendix sections.

**Default:** one coder. Rubric ≥ 2 → sequential breakdown, one-at-a-time Execution order. No parallel branches.

**Spec caps:** Problem/Goal ≤2 sentences each; Confirmed decisions ≤8; Contract ≤8 rows; Key decisions ≤10; Coder Context ≤5; Out of scope ≤8; PR summary ≤8 lines; no prose outside tables/lists. Keep Data flow + Verification + Out of scope. Mermaid: Data flow ≤8 nodes; Execution-order only if **Coders:** ≥2; else bullets only for Current/Target.

---

## Coder

**Goal:** Implement Spec. One draft PR (issue link + Spec summary ≤8 lines).

**Load:** `PHASE-CODER.md`. `QUALITY-TRIGGERS.md` self-check for flagged `Rn`; matching `QUALITY-RULES.md` sections only if a check is unclear.

**Do not:** CI watch, Reviewer phase, `PHASE-SEQUENTIAL.md`, Linear MCP (unless standalone + `LINEAR.md`).

---

## Reviewer

**Goal:** Run `/goal` in `PHASE-REVIEWER.md`. Human merges.

**Load:** `PHASE-REVIEWER.md`. Then `QUALITY-TRIGGERS.md` + matching `QUALITY-RULES.md` sections only. UI in scope → `VISUAL-CAPTURE.md`.
