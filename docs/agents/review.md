# Reviewing a pull request

Required when the matching trigger in [AGENTS.md](../../AGENTS.md) applies.
This is the protocol agent reviewers follow; the author answers findings as [delivery](./delivery.md) describes.

## Before the first finding

- **Read instructions from the PR's base ref.** Resolve it with `gh pr view <n> --json baseRefName` (a stacked PR's base is the preceding branch), run `git fetch origin <base>`, then load `AGENTS.md`, scoped instructions, `docs/agents/`, and skills from it (`git show origin/<base>:<path>`), so the rules you apply are the ones the PR is judged against, including when the PR edits them.
- **Review the current head.** Fetch, note the head SHA, and cite it in the review. A finding from an earlier head counts only after you confirm it on the current one.

## Each finding

Give every finding a severity (Critical, Important, Minor) and an origin:

- **Introduced by this PR**: the diff adds or changes the code at fault.
- **Pre-existing**: the same fault is on the base branch.

For a lint rule or another guardrail, judge severity against agents copying patterns they find, not an attacker: a bypass is Critical or Important only if an agent would plausibly write it (a pattern a dependency or our own code ships counts), and an exotic one is Minor. A false positive that fails safe (an error on contrived code, fixed by renaming) is Minor. Report a class of bypass as one finding and ask for the general fix, not one finding per syntax shape.

Only introduced Critical and Important findings block a merge. Record each pre-existing finding in the review as a follow-up, and link a Task when one already exists or filing is authorized ([issue tracker](./issue-tracker.md)); it does not hold the PR.

## Always check

- **Effect baseline never grows** ([ADR-0075](../adr/0075-effects-live-only-in-named-hooks.md)): flag as Critical any edit to `apps/web/effect-baseline.json` or `apps/cmo/effect-baseline.json` that adds a file or raises a file's count, and any `biome-ignore` suppressing the effect rule.
- **No general-callback hook in `src/hooks/effects/`**: flag as Critical any hook in `apps/web/src/hooks/effects/` or `apps/cmo/src/hooks/effects/` that accepts a general effect callback (such as a replacement for `useMountEffect`); hooks in `effects/` must own one specific external synchronization job (callbacks for that job, like an event handler or interval tick, are fine).

## Rounds

Run at most three review rounds. After round three, one more narrow round may check a small fix for a finding from that round. Then a human decides: list the open findings with their severity and origin, and stop.
