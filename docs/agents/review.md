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

Only introduced Critical and Important findings block a merge. Record each pre-existing finding in the review as a follow-up, and link a Task when one already exists or filing is authorized ([issue tracker](./issue-tracker.md)); it does not hold the PR.

## Rounds

Run at most three review rounds. After round three, one more narrow round may check a small fix for a finding from that round. Then a human decides: list the open findings with their severity and origin, and stop.
