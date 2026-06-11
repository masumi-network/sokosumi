# Cursor Automation (optional)

Optional Linear-triggered Cloud Agents for Team Sapphire. Default path is MCP handoff in `../_task/HANDOFF.md`.

## One issue, one trigger

`_task` delegates **Cursor on the issue** at handoff. Tech Lead later adds `[repo=masumi-network/sokosumi]` to the **same issue** when writing `## Spec`.

Do **not** add Cursor Automations that trigger on description contains `[repo=…]` alone — that can start a second agent when the spec is written and race Sapphire's Coder phase.

Use **at most one** trigger per issue: MCP `delegate`, optional automation below, or manual `@Cursor` — not combined.

## Do not combine with default `_task` handoff

Default `_task/HANDOFF.md` step 2 sets `delegate: "Cursor"` on every handoff. Linear already starts a Cloud Agent from that delegation.

**Do not enable the automation below** when using default `_task` handoff — trigger **Delegate assigned → Cursor** fires twice and can start **two** Team Sapphire runs on one issue.

Use the automation **only** as a **replacement** for MCP delegate, not an add-on:

| Handoff mode | `_task` step 2 (`delegate`) | Cursor Automation |
|--------------|----------------------------|-------------------|
| **Default (recommended)** | Yes | **No** — leave automation disabled |
| **Automation-only team** | **No** — skip delegate in handoff runbook | Yes |

If the team enables automation, document in the runbook that `_task` must post the footer (step 1) but **omit** step 2 delegate.

## Optional automation

**Replacement for delegate only** — see **Do not combine with default `_task` handoff** above.

Prefer MCP `delegate` from `_task/HANDOFF.md`. If the team uses automation instead, omit MCP `delegate` on the same issue.

| Field | Value |
|-------|--------|
| Name | SOK Team Sapphire → orchestrator |
| Trigger | Linear — Delegate assigned → `Cursor` |
| Filter | Team SOK; description contains `## Sapphire status` |
| Tools | Linear MCP, GitHub MCP — computer use is built into Cloud Agents (no separate Browser MCP required) |
| Instructions | Read repo `.cursor/skills/_team-sapphire/SKILL.md`. Run full squad on this issue: Investigator → Tech Lead → Coder → Reviewer. Single issue only — no child issues. Reviewer: verify UI via **computer use**; attach evidence as **PR artifacts** per `VISUAL-CAPTURE.md`. Do not re-delegate or `@Cursor` on the same issue. |

Filter on `## Sapphire status`, **not** `[repo=…]` alone — the repo hint is added later on the same ticket.

## Cloud environment (Reviewer visuals)

Cloud Agents need a configured environment before Reviewer can capture UI. See [Cloud agent setup](https://cursor.com/docs/cloud-agent/setup) and `VISUAL-CAPTURE.md`.

| Setup item | Why |
|------------|-----|
| Environment snapshot + `pnpm install` | Agent can build and run the monorepo |
| `terminals` / `start` with `pnpm web:dev` (+ core if needed) | Reviewer hits `localhost:3000` |
| **Secrets tab** | Web/core env vars + Sokosumi login (and TOTP if used) |
| Optional: embed artifacts in PR | Dashboard → allow posting artifacts to GitHub |

Reviewer does **not** need `agent-browser` or IDE Browser MCP on Cloud — **computer use** produces screenshots and videos on the PR automatically.

## Manual path

No automation: `_task` handoff uses MCP `delegate` or one `@Cursor` comment per `../_task/HANDOFF.md`.

## Auth notes

- Cursor admin: connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent: enable Linear + GitHub MCP on the agent run (first delegated run may need OAuth once per user).
- Reviewer visuals: configure **environment + Secrets**; capture via **PR artifacts** (`VISUAL-CAPTURE.md`). Use `agent-browser` only as an optional fallback documented there.
