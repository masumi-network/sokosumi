# Eval run summaries

One Markdown file per eval run a PR needed: what ran, the results, what failed and why, and whether the change should ship. Runs on a local Core or in an agent's scratchpad vanish with their database; these files keep them. The rule that requires them is in [`docs/agents/evals.md`](../../agents/evals.md).

## Naming

`YYYY-MM-DD-<slug>.md`: the date the run started (UTC) and a short slug for what it measured, such as `2026-11-20-cmo-v8.md`. Without `--slug` the CLI uses `pr-<number>`, then the current git branch, then the start of the run id.

## Making one

```bash
sokosumi evals show RUN_ID --summary-md --slug cmo-v8              # writes docs/evals/runs/2026-11-20-cmo-v8.md
sokosumi evals show RUN_ID --summary-md --out path/to/summary.md   # choose the path
```

Run it from the repository root, with the same `--api-url` or `--preprod` the run used. The command fills everything down to "Failed cases" from the run. Write the last three sections yourself, run `pnpm exec biome format --write` on the file (Biome pads Markdown tables, and the pre-commit check fails until it has), then commit the file in the PR that needed the run and link it from the PR's Evidence.

Files marked "backfilled from the agent report" were written by hand from an agent's report before this command existed; where no run id is given, the run's data is gone.

## Template

```markdown
# Eval run: <slug>

- Date: YYYY-MM-DD
- Run: `<run id>` (manual, completed)
- Environment: local | preprod | preview | mainnet
- Commit: `<sha>` <commit subject>, PR #<n>
- Bots: Soko Bot <version> (<model>), Cuso <version> (<model>)
- Judge: claude-code:<model> | <Gateway model>
- Repeats: 1
- Cost: $0.00

## Results

<the `--markdown` table>

## Before and after

Baseline: weekly run <id> of YYYY-MM-DD (#<pr>). One row per case whose pass rate changed, or "No baseline".

## Failed cases

### `<case id>`: <title>

- Failed check: <label>: <actual>
- Judge: <verdict>, <rationale>

## Why the failures happened

The cause of each failure, or why it does not matter.

## Verdict

Ship or don't ship, because …

## Links

Sheets, screenshots, the PR.
```
