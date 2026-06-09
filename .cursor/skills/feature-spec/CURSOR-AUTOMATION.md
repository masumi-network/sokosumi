# Cursor Automation (optional)

Use when you want Cloud Agents to start without manual assign **after the right agent has run**.

This is optional. Prefer MCP handoffs in the pipeline:

1. **`_task`** — posts the **requirement** issue, creates **Write PRD** sub-task with `delegate: "Cursor"` **or** relies on Write PRD automation — never both, and no `@Cursor` comments on the default MCP path → feature-spec (not coding).
2. **`feature-spec`** — posts the **implementation** issue with full PRD, creates sub-tasks, then `delegate: "Cursor"` → coding agent.

Do **not** trigger a coding automation on bare SOK issues with Feature/Bug/Improvement labels. Requirement issues and Write PRD sub-tasks use the same team, project, state, and labels but are **not** implementation PRDs.

## Lifecycle

```mermaid
flowchart LR
  todo["Todo\n(PRD published)"] --> progress["In Progress\n(Cursor working)"]
  progress --> review["In Review\n(PR opened)"]
  review --> verify["Verify sub-task\n/goal loop"]
  verify --> pass["Review Done\n(evidence attached)"]
  pass --> human["Human merge\nparent Done"]
```

| State | Who sets it | When |
|-------|-------------|------|
| `Todo` | Spec agent | Implementation issue created |
| `In Progress` | Cursor (optional) | Agent starts work |
| `In Review` | **Coding agent (required)** | PR opened — see completion protocol below |
| `Done` | Human | After PR merge **and** verify sub-task is Done |

The implementation issue (PRD task) must land in **In Review** when the coding agent finishes — not Done. Human merge waits for the **Verify implementation** sub-task to reach **Done**.

## Completion protocol (Cursor Cloud Agent)

Every coding run must end with this, whether triggered by delegate, `@Cursor`, or automation:

1. Open PR with verification from the PRD.
2. Linear MCP `save_issue` on the **implementation issue** (the delegated issue):

   ```json
   {
     "id": "SOK-XXX",
     "state": "In Review"
   }
   ```

3. `save_comment` on the same issue with PR URL and short summary.
4. Delegate the **Verify implementation** sub-task to Cursor and post the `/goal` handoff — see `PRD-REVIEWER.md`.
5. Do **not** mark the implementation issue Done or close sub-tasks.

The PRD template includes **Agent completion** and **Reviewer completion** sections so delegated issues carry these instructions in the description.

## Reviewer automation (optional, third)

Create a third Cursor Automation if you want the reviewer to start without the coding agent posting the handoff comment:

| Field | Value |
|-------|--------|
| Name | SOK verify implementation → reviewer |
| Trigger | Linear — Status changed → `In Review` |
| Filter | Team SOK; issue has child titled `chore(review): verify implementation against PRD` |
| Tools | GitHub, Linear, browser (for screenshots) |
| Instructions | Read parent issue as PRD. Read `PRD-REVIEWER.md` in repo. Run `/goal` until lint, test, build, and visual evidence pass. Fix on PR branch. Mark verify sub-task Done when complete. |

Prefer the coding agent handoff in `PRD-REVIEWER.md` so PR URL and branch are always in the first comment.

## Pipeline (required order)

```mermaid
flowchart LR
  task["_task skill"] --> req["Requirement issue"]
  task --> writePrd["Write PRD sub-task\n(delegate or automation)"]
  writePrd --> spec["feature-spec skill"]
  spec --> impl["Implementation issue\n[repo=…] + PRD"]
  impl --> code["Coding agent"]
```

| Stage | Issue shape | Who triggers Cursor | Automation? |
|-------|-------------|---------------------|-------------|
| Requirement | High-level brief, no `[repo=…]`, no Verification section | None — informational comment only; no `@Cursor` | — |
| Write PRD | Title `chore(spec): write implementation PRD`, child of requirement | `_task` via `delegate: "Cursor"` on create (default), **or** optional automation below — not delegate + automation + `@Cursor` | Optional spec automation below |
| Implementation | Full PRD, `[repo=masumi-network/sokosumi]`, Data flow / Verification | `feature-spec` via `delegate: "Cursor"` on `save_issue` **after** verify sub-task exists | Optional coding automation below |

Default path: MCP delegate + handoff comments in `_task/HANDOFF.md` and `LINEAR-MCP.md`. Automations are fallbacks only.

## Recommended automation setup

Create **two** Cursor Automations (or rely on MCP only and skip both).

### 1. Spec agent — Write PRD sub-task

| Field | Value |
|-------|--------|
| Name | SOK Write PRD → feature-spec |
| Trigger | Linear — Issue created |
| Filter | Team SOK; title exactly `chore(spec): write implementation PRD` |
| Tools | Linear |
| Instructions | Read repo `.cursor/skills/feature-spec/SKILL.md` and linked files. Intake **parent requirement** via Linear MCP `get_issue`. Run full feature-spec workflow: discovery → implementation PRD → publish implementation issue with `parentId` → Confirm + Verify sub-tasks → delegate coding agent. Do **not** implement code on this sub-task. |

Matches `_task/HANDOFF.md`. Fires only on the PRD handoff sub-task, not on requirement issues. When this automation is enabled, `_task` must **omit** `delegate: "Cursor"` on Write PRD create to avoid duplicate agents.

### 2. Coding agent — implementation issue

| Field | Value |
|-------|--------|
| Name | SOK implementation → Cloud Agent |
| Trigger | Linear — Delegate assigned → `Cursor` (or Issue updated when delegate becomes Cursor) |
| Filter | Team SOK; description contains `[repo=masumi-network/sokosumi]`; title does **not** start with `chore(spec):` or `chore(review):` |
| Tools | GitHub, Linear |
| Instructions | Read the issue description as the implementation PRD. Follow verification and out-of-scope sections. Open a PR when done. Repo from `[repo=…]` in the description. **When the PR is open:** set this issue to `In Review`, comment with the PR link, delegate the Verify implementation sub-task with `/goal` per `PRD-REVIEWER.md`, and do not mark Done. |

The `[repo=…]` line is spec-agent output only (`TEMPLATE.md` / `LINEAR-MCP.md`). Requirement issues from `_task` must not include it.

### Optional: status-changed automation

If you want a separate automation when Cursor updates Linear:

| Field | Value |
|-------|--------|
| Trigger | Linear — Status changed → `In Review` |
| Filter | Team SOK, delegate is Cursor |
| Action | Slack notify / assign human reviewer (team choice) |

This is optional. The required behavior is Cursor setting **In Review** on completion, not a follow-up automation.

## Linear triage rules (alternative)

Prefer MCP handoffs. If you use triage, match **issue role**, not team label alone.

### Spec handoff (optional)

1. Issue created in SOK
2. Title is `chore(spec): write implementation PRD`
3. Assign delegate **Cursor** (runs feature-spec, not coding)

### Coding handoff (optional)

1. Issue in SOK with delegate **Cursor** (set after verify sub-task exists — not on bare create)
2. Description contains `[repo=masumi-network/sokosumi]`
3. Title does **not** start with `chore(spec):` or `chore(review):`
4. Child titled `chore(review): verify implementation against PRD` exists (spec agent creates it before delegate)

Do **not** use `**Linear:**` as a filter — `_task` shows that line in chat drafts and implementation PRDs both use metadata lines; it does not distinguish requirement vs PRD.

Note: Linear triage may require a human assignee on some plans. MCP `delegate: "Cursor"` on the implementation issue (step 9, after sub-tasks) avoids that.

## Repo labels in Linear

So Cloud Agent picks the repo without repeating `[repo=...]` every time:

1. Linear Settings → Labels → New group → name exactly `repo`
2. Add child label `masumi-network/sokosumi`
3. Spec agent adds that label on implementation issues (optional)

## Auth notes

- Cursor admin must connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent needs **Linear MCP** enabled to set `In Review` on completion.
- Bot-created issues (Slack, MCP) should use org-level Linear connection; see Cursor forum updates on automation auth fallback.
- First `@Cursor` mention may prompt account linking.

## Manual fallback

On any implementation issue:

1. Assign **Cursor** as delegate, or
2. Comment:

   ```markdown
   @Cursor implement per the PRD above.

   [repo=masumi-network/sokosumi]

   When the PR is open: set this issue to In Review, comment with the PR link, delegate Verify implementation with `/goal` per PRD-REVIEWER.md. Do not mark Done.
   ```
