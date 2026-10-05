---
name: review-bot
description: Use when a `/grok review`, `/muse review`, `/claude review`, `/cursor review`, or `/codex review` comment is posted on a pull request in a watched repo, a review-bot watcher emits ACTION_REQUIRED, a second trigger arrives while a review is already running, or the user runs /review-bot.
argument-hint: "[watch | <pr-number>] [--reviewer <name>]"
---

# Review bot

On-demand PR loop for a watched repo: review the diff, fix Critical and Important, tell the author what changed, **leave no worktree**.

**REQUIRED SUB-SKILL:** code-review. It must be available where the child runs — source: [mattpocock/skills](https://github.com/mattpocock/skills).
The sub-skill is unavailable only when its `SKILL.md` cannot be read. Then do an ad-hoc review, name the missing skill in the PR comment, and give `npx skills add mattpocock/skills -s code-review -g -y`. If `SKILL.md` was read, follow it. Failing to spawn a nested reviewer is not a missing skill, and that comment must not contain an install line.

Do not merge. Do not approve the PR. Do not fix Minors unless they are one-line and already in a file you are editing.

## Reviewer

The reviewer is defined by the CLI running this skill. Set `REVIEWER` once at the start of the run from your CLI's row — you know which CLI you are; do not guess from environment variables. If you genuinely cannot tell which CLI you are, see Invocation:

| CLI | REVIEWER | Trigger comment | Summary header |
|-----|----------|-----------------|----------------|
| Grok | `grok` | `/grok review` | `## Grok review` |
| Muse Code | `muse` | `/muse review` | `## Muse review` |
| Claude Code | `claude` | `/claude review` | `## Claude review` |
| Cursor | `cursor` | `/cursor review` | `## Cursor review` |
| Codex | `codex` | `/codex review` | `## Codex review` |

- A watcher `ACTION_REQUIRED` payload carries a `reviewer` field — that value is `REVIEWER` for the run.
- Otherwise `REVIEWER` comes from the invocation (see Invocation): your CLI's row by default, `--reviewer <name>` to override, or asked interactively when `/review-bot` is bare.
- If your CLI is not listed, use its lowercase session/binary name and follow the same conventions (`/<name> review`, `## <Name> review`).
- The capitalized form (`Grok`, `Muse`, …) goes in prose and headers; the lowercase form goes in trigger phrases, state paths, and script flags.
- One watcher per trigger phrase. `review-bot` with `grok` watches the same phrase as the standalone `grok-review` skill — run only one of them.

## Invocation

Parse trailing args as `[watch | <pr-number>] [--reviewer <name>]`:

| Invocation | Mode | Reviewer |
|------------|------|----------|
| `/review-bot` | ask: watch or one-shot (which PR?) | ask |
| `/review-bot watch` | watch | own CLI |
| `/review-bot 4345` | one-shot PR 4345 | own CLI |
| `/review-bot watch --reviewer muse` | watch | `muse` |
| `/review-bot 4345 --reviewer codex` | one-shot PR 4345 | `codex` |
| `/review-bot --reviewer muse` | ask: watch or one-shot (which PR?) | `muse` |

- Bare `/review-bot` asks for the reviewer name — offer your own CLI as the recommended default plus the known names — and for the mode (watch vs PR number) in the same round of questions. If you cannot ask (non-interactive run), fall back to your own CLI's reviewer in watch mode and say so.
- If you cannot determine which CLI you are, ask the user for the reviewer name before proceeding — even when the mode was given. Never guess the reviewer. In a non-interactive run where you cannot ask, stop and report that the reviewer is unknown instead of picking one.
- `watch` and `<pr-number>` are mutually exclusive; if both appear, ask which was meant.
- A `--reviewer` name outside the table is allowed when it is a sane lowercase name (letters, digits, `-`, `_`); trigger phrase, header, and state dir derive from it the same way.
- The override lasts for this run only.

## Done

A run is done only when all of these are true:

1. Reviewer findings exist (or an explicit empty-review note).
2. Every **verified** Critical and Important finding is fixed, committed, and pushed — or recorded as disagreed with a reason.
3. One PR comment is posted (template below). Trigger comment has a reaction.
4. The worktree this run created is **gone** (absent from the worktree list — see Cleanup).

Step 4 is a `finally`. Child crash, empty diff, push failure — still remove the worktree.

## Trigger

- Watcher `ACTION_REQUIRED` JSON, or `/review-bot <n>`.
- Issue comment whose first non-empty line is `/<REVIEWER> review` or `/<REVIEWER> review <focus>`.
- Author must be the watcher owner (the `gh`-authenticated login by default, `--author` overrides). Anyone else is ignored.
- Open PR only. Ignore repeats of a `databaseId` already handled.

## Orchestrator (this session)

Keep the main checkout on its current branch. Do the PR work in a child. One-shot (`/review-bot <n>`) has no payload: take the repo from the current checkout's origin; there is no trigger comment, so skip the reactions.

The persistent watcher stays up for the whole session. A child in flight is not a reason to stop the monitor, start a second poller, or ignore `ACTION_REQUIRED`.

With verified wake callbacks, return to idle after spawning a child. Child-done and `ACTION_REQUIRED` are separate wakeups. Without callbacks, an active coordinator must consume both events; ending its turn stops the handoff. Do not block monitoring on a child (no long `get_command_or_subagent_output` / process-wait).

Track each in-flight child as `{pr, comment_id, worktree_path}`. Cleanup is per child.

Persist each received payload and its child record in a dispatch journal beside the watcher state. Record `pending`, `running`, `failed`, `ignored`, or `complete`, plus summary URL and cleanup result. Mark `complete` only after the Done criteria and final reaction. A repeated delivery of the same comment ID leaves its existing record unchanged. A distinct comment ignored because its PR is already in flight gets an `ignored` record with the reason and covering comment ID; it is not a completed review and is not replayed. On restart, reconcile live coordinators and children before resuming unfinished records or accepting new work. `seen.json` records detection, not review completion.

1. React `eyes` on the trigger comment (`<repo>` is the payload's `repo`):
   `gh api repos/<repo>/issues/comments/<id>/reactions -f content=eyes`
2. Spawn one isolated child for the PR, working in a fresh worktree off the checkout whose origin matches the payload's `repo`. Prompt: the Child section plus PR number, comment id, focus text, repo, `REVIEWER`, and this session's watcher checkout (`pwd -P`). The child runs `pwd -P` first and returns `worktree_path`.
   - Grok: `spawn_subagent` with `general-purpose`, `isolation: "worktree"`, `background: true`.
   - Muse: `subagent_spawn` with `worktree_isolation: true` (or a `workflow` child with `isolation: true`).
   - Claude Code: `Agent` tool with `subagent_type: "general-purpose"`, `isolation: "worktree"` (worktree lands at `.claude/worktrees/agent-<agentId>`). Completion is a notification; its `<worktree>` block carries the `worktreePath` and `worktreeBranch`.
   - Cursor: start one background `cursor agent -w review-bot-<n> --workspace <checkout> -p --force "<prompt>"` shell process (worktree lands at `~/.cursor/worktrees/<reponame>/review-bot-<n>`).
   - Codex: start one background `codex exec --enable worktrees --worktree --json "<prompt>"` terminal process.
3. Isolation holds only when `worktree_path` is set and is a different directory than the watcher checkout. If it is missing or equal: abort that child before it runs `gh pr checkout`, restore the watcher checkout if HEAD moved, react `confused`, and queue the comment until an isolated spawn can succeed.
4. On child-done: remove **that** child's worktree (Cleanup) and confirm it is gone. Never remove the watcher checkout, even if a child reported that path. React `+1` when the child posted the summary; `confused` if it failed after cleanup.

On a new wakeup while a child is running:

| Condition | Action |
|-----------|--------|
| same `comment_id` | ignore (already handled) |
| same PR already in flight | ignore |
| different PR, isolation can produce a distinct worktree | spawn (steps 1–2) |
| different PR, isolation would land in the watcher checkout | do not spawn; queue until in-flight children on the watcher checkout are done and parent HEAD is restored |

## Child

Work only inside the isolated worktree. `REVIEWER` comes from the orchestrator prompt. The prompt includes the watcher checkout path. Run `pwd -P` first. If it equals the watcher checkout, stop immediately and report `isolation_failed` — do not `gh pr checkout`.

1. Attach the PR head without checking it out in the parent:
   ```bash
   gh pr checkout <n>
   ```
   Use `gh pr checkout`, never a raw `git fetch origin pull/<n>/head` + `git checkout -B <headRefName> origin/<headRefName>`: that fetch writes only `FETCH_HEAD` and never creates `origin/<headRefName>`, so the checkout succeeds only by luck on a same-repo PR (an earlier plain fetch had already mirrored the ref) and always fails on a fork PR. `gh pr checkout` creates the local branch and configures its push target, fork or not.
   If that branch is already bound to another worktree, `gh pr checkout <n> --detach`; step 5 then needs an explicit push target: `git push <head-remote> HEAD:<headRefName>`, with the head remote from `gh pr view <n> --json headRepositoryOwner,headRefName`.
2. Resolve the PR's real base — never hardcode `origin/main`:
   ```bash
   BASE_REF=$(gh pr view <n> --json baseRefName --jq .baseRefName)
   git fetch origin "+${BASE_REF}:refs/remotes/origin/${BASE_REF}"
   BASE_SHA=$(git merge-base "origin/${BASE_REF}" HEAD)
   HEAD_SHA=$(git rev-parse HEAD)
   ```
   A stacked PR targets another branch, not `main`, and `origin/main` then drags that base's whole divergence into the range — measured on a real one: 60 files in range against 5 actually changed. The reviewer reports findings in untouched code and step 5 pushes fixes for them. The explicit `+<ref>:refs/remotes/origin/<ref>` refspec matters for the same reason as step 1: a bare `git fetch origin <ref>` writes only `FETCH_HEAD`. Keep the `${BASE_REF}` braces — under zsh, an unbraced `$BASE_REF:refs/...` is parsed as the `:r` modifier and silently fetches a mangled ref.
3. **REQUIRED:** code-review with `$BASE_SHA` as the fixed point. Write the PR title and body to `$(git rev-parse --git-dir)/review-spec.md` (untracked, gone with the worktree) and pass that path as the spec, so the skill never stops to ask for one. Reviewer is read-only. Grade its findings:
   - **Critical**: Spec (c), a requirement implemented wrong.
   - **Important**: Spec (a), a requirement missing or partial; a hard violation of a documented standard.
   - **Minor**: baseline smells and other judgement calls; Spec (b), scope creep, which is the author's call to keep or drop.
4. Treat each Critical and Important finding as a hypothesis: read the cited code, reproduce behavioural claims, and fix only what holds. A finding that does not hold goes under Skipped / disagreed with the evidence. Skip Minors (list them).
5. If you changed files: conventional commit, `git push` (or `git push --force-with-lease` only after a rebase you started). Never `--force`. A fork PR without "Allow edits by maintainers" rejects the push — keep the findings, post the comment, and say the push was rejected under Remaining.
6. Post **one** PR issue comment with `gh pr comment <n> --body-file` (not a formal review). Do not put `/<REVIEWER> review` — or any other CLI's trigger phrase — in that body.

### Author comment

```markdown
## <Reviewer> review

Picked up `/<reviewer> review` from @<author> (request: <trigger-comment-url>).
(For one-shot runs: "Requested directly for PR #<n>.")

### Fixed
- <severity>: <what> (`<sha>` — `<path>`)
(or "Nothing pushed — no verified Critical/Important findings.")

### Remaining
- Minor: <path>: <issue>
- Skipped / disagreed: <issue> — <why>

### Assessment
Ready to merge: Yes | With remaining notes
<one sentence>
```

## Cleanup (non-negotiable)

Remove the worktree, then confirm it is gone:

- Grok: `grok worktree rm --force <id-or-path>`, confirm absent from `grok worktree list --json`. If `grok` fails, `git worktree remove --force <path>` from the source repo, then confirm again.
- Claude Code: `git worktree remove --force <worktreePath>` from the main checkout, confirm absent from `git worktree list`, then `git branch -D <worktreeBranch>` — removing the worktree leaves its branch behind. `ExitWorktree` does not apply: it only touches a worktree this session entered, never an `Agent` one.
- Cursor: `git worktree remove --force <worktree_path>` from the source repo, confirm absent from `git worktree list`, then `git branch -D <worktreeBranch>` if `-w` left a branch — ending the `cursor agent` process does not remove the worktree.
- Codex: `git worktree remove --force <worktree_path>` from the source repo, then confirm no exact `worktree <worktree_path>` record remains in `git worktree list --porcelain`; deleting the Codex session alone does not remove the worktree.
- Any other CLI: `git worktree remove --force <path>` from the source repo, confirm with `git worktree list`.

| Excuse | Reality |
|--------|---------|
| "Child will delete it" | Parent deletes. Child may be dead. |
| "Keep it for debug" | Log the path, then remove it. |
| "git worktree remove is enough" (Grok) | Prefer `grok worktree rm --force` so Grove tracking matches disk. |
| "Empty review, no worktree needed" | If you created one, remove it. |
| "Child reported the parent path, remove it" | Never remove the watcher checkout. Isolation failed; restore HEAD if needed. |

Do not `grok worktree gc` or delete other sessions' worktrees.

## Watcher

Skill: `~/.agents/skills/review-bot/`. Script: `scripts/watch-review.py`.

State is per reviewer+repo: `~/.agents/plugin-data/<reviewer>-review/<owner>__<repo>/seen.json` (logs beside it under `logs/`; a legacy flat `seen.json` seeds the new path once). Each reviewer has its own trigger phrase, so watchers for different CLIs — or different repos — run side by side without double-handling. Never run two watchers on the same reviewer+repo: they share one `seen.json` and would race.

The script needs to know its reviewer: pass `--reviewer <name>` from the table above, or export `REVIEW_BOT_REVIEWER=<name>`. It refuses to run without one — a silent default would watch the wrong trigger phrase.

### Verify the handoff before starting

Watch mode needs both a GitHub poller and an agent that handles its output after the interactive turn ends. A running PID, an existing `/loop` skill, or a waiting subagent does not prove that handoff works.

1. Inspect the actual callable tools. Choose a timer/cron tool that submits prompts, or a monitor with an output callback. Use `/loop` only when its required scheduling or `notify_on_output` capability is available.
2. Verify a harmless scheduled wake reaches the agent while idle. For an active background coordinator, verify a local probe is consumed and recorded after the parent yields. Do not post a test trigger on GitHub.
3. Run the initial poll and inspect its log for errors. The script can log a poll error and still exit 0; quiet stdout alone is not a clean poll.
4. Report watch mode active only after the handoff, successful poll, and pending-request recovery are verified. Record the timer/monitor handle or coordinator PID, logs, and stop method.

For Codex without wake tools, use the persistent coordinator in [Codex watch without callbacks](references/codex-watch.md). If no working handoff can be started under the session's permissions, report watch mode unavailable and stop the timer, monitor, coordinator, or poller created during the failed attempt, reconciling its children and cleanup first. Preserve pending records. Do not leave a poller consuming comments without a reviewer.

### Recover an emitted request

Compare the journal with `emit pr=<n> comment_id=<id>` records in watcher logs, including emissions before the journal existed. Skip `complete` and explicitly `ignored` records. For another emitted ID, reconcile any recorded live child first; fetch its comment and PR, verify reviewer, author, and open state, then queue it even if its ID is already in `seen.json`. Do not replay silent-baseline IDs or all seen IDs.

If a crash happened after posting the summary, use its request link to find the existing comment, resume cleanup and the final reaction, and complete the journal record. Reuse the existing summary rather than posting a second one. If prior effects cannot be verified, keep the record pending and report the uncertainty.

### Start (`/review-bot watch`)

1. Open your CLI in the checkout you want to watch. Prefer `main`, not a feature worktree.
2. Verify the handoff above, then use the matching recipe with the resolved reviewer name (see Invocation). Default cadence is every 3 minutes: a prompt-submitting scheduler wakes the model and re-reads session context, so cadence sets watch cost almost linearly (measured on Muse: ~24M mostly-cached input + ~55k output/hour at 30s cadence; a single 3-minute job cuts that ~6x). Poll faster only when pickup latency matters. Cron minimum is 1 minute — sub-minute needs two offset jobs (e.g. a second job that sleeps 30s first); the pair is one logical watcher sharing one `seen.json`, so offsets must exceed poll duration and each fire must still honor in-flight state.
   - Grok: run the script with `--reviewer grok --poll-interval 30` in the `monitor` tool with `persistent: true` (one monitor only). Do not run `--once` in this session while that monitor is up. `/rename review-bot` and leave the session idle.
   - Muse: `muse.cron_create` with `cron: "1-59/3 * * * *"` and a short prompt that runs the `--once` poll below, then starts a run per Orchestrator on each `ACTION_REQUIRED` line. Recurring jobs auto-expire after 7 days.
   - Claude Code: `CronCreate` with `cron: "1-59/3 * * * *"` and a prompt that runs the `--once` poll below, then starts a run per Orchestrator on each `ACTION_REQUIRED` line. Jobs are session-only (gone when the session exits), fire only while the REPL is idle, and recurring ones auto-expire after 7 days — re-create it when you restart the session.
   - Cursor: `/loop 3m In <checkout>, run python3 ~/.agents/skills/review-bot/scripts/watch-review.py --reviewer cursor --once; for each ACTION_REQUIRED line, follow Orchestrator.` Keep the session open.
   - Codex: when `/loop` has a verified wake mechanism, run `/loop 3m In <checkout>, run python3 ~/.agents/skills/review-bot/scripts/watch-review.py --reviewer codex --once; for each ACTION_REQUIRED line, follow Orchestrator.` Otherwise use [Codex watch without callbacks](references/codex-watch.md).
   - Any other CLI: schedule a prompt that runs the poll and follows Orchestrator every 3 minutes. OS cron or `launchd` running only the Python poller detects comments but does not invoke a reviewer. The poll command is:

```bash
cd <checkout> && python3 ~/.agents/skills/review-bot/scripts/watch-review.py \
  --reviewer muse \
  --once
```

(`muse` above is an example — use the resolved reviewer name.) The repo is parsed from the `origin` remote of the cwd — run from the checkout you want to watch (`--repo owner/name` overrides auto-detect, `--repo-dir <path>` resolves origin elsewhere). The author defaults to the `gh`-authenticated login (`--author <login>` overrides). `--once` does one poll and exits 0; with existing state it prints `ACTION_REQUIRED` JSON for new trigger comments. Without state, the first poll silently baselines existing triggers; report "Baseline recorded" rather than claiming no reviews are waiting. Handle a request explicitly identified by the user through recovery or a one-shot run. Without `--once` the script polls forever; its output still needs the verified handoff.
3. When a poll prints `ACTION_REQUIRED`, start a run per the Orchestrator section (its `reviewer` field is `REVIEWER`, its `repo` field is the target repo). Manual one-shot: `/review-bot 4345`.
4. Quiet, successful polls stay quiet. No `ACTION_REQUIRED` and no pending recovery → the entire reply is one line: the poll result plus in-flight state (e.g. `Clean — nothing in flight.`). End only that scheduled turn; the verified timer/monitor or background coordinator remains active. An active coordinator without wake callbacks keeps consuming events instead of ending its overall turn. Report poll or handoff failures as failures. Keep scheduled prompts short — point at this file for the protocol instead of inlining it.
