# Cursor Automation (optional)

Reference for Linear-triggered Cloud Agents. **Default path:** MCP `delegate` from `../_task/HANDOFF.md` — do **not** enable the automation below.

## One issue, one trigger

`_task` handoff sets `delegate: "Cursor"` on the issue after posting `## Sapphire status`. That alone starts Team Sapphire on a Cloud Agent.

Use **at most one** start path per issue:

| Path | When to use |
|------|-------------|
| **MCP delegate (default)** | `_task/HANDOFF.md` step 2 — recommended |
| **Manual `@Cursor`** | MCP delegate unavailable — one comment per `../_task/HANDOFF.md` |
| **Cursor Automation below** | **Do not use** with default handoff — see next section |

Do **not** add automations that trigger on description contains `[repo=…]` alone — Tech Lead adds that later and can race the Coder phase.

## Do not enable with default `_task` handoff

The automation below uses trigger **Linear — Delegate assigned → `Cursor`**. That is the **same** event as `_task/HANDOFF.md` step 2.

Enabling it while `_task` sets `delegate: "Cursor"` can start **two** Team Sapphire runs on one issue.

**Keep this automation disabled** when using default `_task` handoff.

### No automation-only handoff

There is **no** supported path where `_task` omits `delegate` and this automation starts Sapphire:

- Trigger requires **Delegate assigned → `Cursor`**.
- Footer-only handoff (step 1 without step 2) never assigns a delegate, so the automation **never fires**.

To start without MCP delegate, use the **manual `@Cursor`** comment in `../_task/HANDOFF.md` — not this automation.

## Reference automation (disabled by default)

Documented for teams that **stop using `_task` MCP delegate entirely** and accept maintaining a separate Linear→Cursor integration. Even then, prefer manual `@Cursor` unless Cursor adds a trigger that does not duplicate delegation (e.g. issue updated with `## Sapphire status` only).

| Field | Value |
|-------|--------|
| Name | SOK Team Sapphire → orchestrator |
| Trigger | Linear — Delegate assigned → `Cursor` |
| Filter | Team SOK; description contains `## Sapphire status` |
| Tools | Linear MCP, GitHub MCP — computer use is built into Cloud Agents |
| Instructions | Read repo `.cursor/skills/_team-sapphire/SKILL.md`. Run full squad on this issue. Single issue only. **Role models:** Tech Lead, Coder, Reviewer (see `.cursor/agents/sapphire-*.md`). **Mandatory:** `PHASE-GATE.md` — post phase comment + update status table after each phase; run exit gate before finishing. Reviewer: PR artifacts per `VISUAL-CAPTURE.md`. |

Filter on `## Sapphire status`, **not** `[repo=…]` alone.

**If enabled:** `_task` must **not** set `delegate` on the same issues, and something else must assign delegate to `Cursor` — otherwise nothing runs. Default teams should use MCP delegate only and leave this **off**.

## Cloud environment (Reviewer visuals)

Cloud Agents need a configured environment before Reviewer can capture UI. See [Cloud agent setup](https://cursor.com/docs/cloud-agent/setup) and `VISUAL-CAPTURE.md`.

| Setup item | Why |
|------------|-----|
| Environment snapshot + `pnpm install` | Agent can build and run the monorepo |
| `terminals` / `start` with `pnpm web:dev` (+ core if needed) | Reviewer hits `localhost:3000` |
| **Secrets tab** | Web/core env vars + Sokosumi login (and TOTP if used) |
| Optional: embed artifacts in PR | Dashboard → allow posting artifacts to GitHub |

Reviewer does **not** need `agent-browser` or IDE Browser MCP on Cloud — **computer use** produces screenshots and videos on the PR automatically.

## Auth notes

- Cursor admin: connect Linear in [Cursor integrations](https://cursor.com/docs/integrations/linear).
- Cloud Agent: enable Linear + GitHub MCP on the agent run (first delegated run may need OAuth once per user).
- Reviewer visuals: configure **environment + Secrets**; capture via **PR artifacts** (`VISUAL-CAPTURE.md`).
