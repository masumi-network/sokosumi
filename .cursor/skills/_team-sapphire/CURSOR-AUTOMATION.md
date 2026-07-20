# Cursor Automation (optional)

Optional Linear → Cloud Agent trigger for Team Sapphire.

## One issue, one trigger

Use **at most one** start path per issue:

| Path | When to use |
|------|-------------|
| **Manual in Cursor** | Default — `Run _team-sapphire for SOK-XXX` |
| **Manual `@Cursor` comment** | One comment on the issue to start a Cloud Agent |
| **Cursor Automation below** | Optional Linear→Cloud integration — enable only if you want auto-start on delegate |

Do **not** add automations that trigger on description contains `[repo=…]` alone — Tech Lead adds that later and can race the Coder phase.

## Manual `@Cursor` comment (Cloud)

```markdown
@Cursor Run _team-sapphire skill for SOK-XXX. Single issue — Investigator, Tech Lead, Coder, Reviewer per `.cursor/skills/_team-sapphire/SKILL.md`. Do not create child issues.
```

Do **not** also set `delegate: "Cursor"` on the same issue when using this comment — duplicate triggers can start two Sapphire runs.

## Reference automation (disabled by default)

Documented for teams that want Linear to start a Cloud Agent when someone assigns delegate to `Cursor` (or an equivalent trigger). Prefer manual `@Cursor` or in-chat `_team-sapphire` unless you maintain this integration carefully.

| Field | Value |
|-------|--------|
| Name | SOK Team Sapphire → orchestrator |
| Trigger | Linear — Delegate assigned → `Cursor` |
| Filter | Team SOK; description contains `## Requirement` |
| Tools | GitHub MCP; Linear MCP optional (Requirement read / rare Requirement edits). Computer use is built into Cloud Agents |
| Instructions | Read repo `.cursor/skills/_team-sapphire/SKILL.md`. Run full squad on this issue. Single issue only. Coder via `sapphire-coder`; Tech Lead/Reviewer on orchestrator unless optional agents. **Do not** post Linear phase reports — PR is the handoff. Reviewer UI: `VISUAL-CAPTURE.md`. |

Filter on `## Requirement`, **not** `[repo=…]`.

**If enabled:** something must assign delegate to `Cursor` (human or a separate process). Otherwise nothing runs. Keep this **off** unless you own that delegate assignment path.

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
