# Codex watch without callbacks

Use this fallback only when the parent has no callable timer or monitored-output wake. A separate Codex coordinator stays active and consumes poller output; it does not depend on waking the interactive parent. PR work still runs in isolated children under the main skill's Child protocol.

## Start

1. Confirm `codex exec --help` supports the needed options and that the session permits starting a background agent. Reuse the CLI's configured model. Keep sandbox and approval controls enabled. `--approve-for-me` routes requests through automatic approval review; use it only when available and allowed. Report rejected actions rather than bypassing approval.
2. Find any existing coordinator and poller for the same reviewer/repo. Reuse a healthy coordinator. Before replacing a broken handoff, retire that run through Stop and recover below: confirm its coordinator and poller exited, reconcile any live children, and perform their cleanup. Preserve its logs and pending requests; leave other runs alone. A stopped poller alone does not retire a live coordinator.
3. Create a unique run directory beside the reviewer's repository state. Write `prompt.md` using the coordinator contract below, with the resolved checkout, repository, reviewer, installed skill path, run directory, and any known missed request supplied explicitly.
4. Launch the coordinator as a process whose stdin and output survive the parent turn. For example, with those paths already set:

```bash
nohup codex exec --json --sandbox workspace-write --approve-for-me \
  --cd "$REVIEW_CHECKOUT" \
  --output-last-message "$REVIEW_RUN_DIR/final.txt" - \
  < "$REVIEW_RUN_DIR/prompt.md" \
  > "$REVIEW_RUN_DIR/events.jsonl" 2>&1 &
REVIEW_COORDINATOR_PID=$!
```

Persist the PID. Adapt approval flags to the actual CLI and session policy before running this command. Request any required permission for writing the run directory or launching the process.

5. Create `probe.request` in the run directory. Yield through a short wait, then verify the coordinator writes `probe.handled` with the same probe value and `status.json` reports a successful initial poll and recovery check. A PID or a startup message alone is insufficient. Known missed requests must be journaled and dispatched, or recorded with a concrete reason they cannot run. Then report the run's PID, log path, and stop method.

## Coordinator contract

Use this as the coordinator prompt, filling the run-specific values before launch:

```text
You are the persistent background review-bot coordinator.
Checkout: <absolute watcher checkout>
Repository: <owner/repo>
Reviewer: <resolved reviewer>
Skill: <absolute installed review-bot/SKILL.md>
Run directory: <absolute durable run directory>
Known missed requests: <PR/comment IDs and focus, or none>

Read the skill. Preserve the watcher checkout's branch and files.
Reconcile recorded live coordinators and children before replaying unfinished
dispatch-journal records or emitted IDs from prior watcher logs. Skip complete
and intentionally ignored records; seen.json is detection state. Validate
comments and open PRs. Inspect existing summaries linked to each request
before retrying side effects. Preserve ambiguous records rather than duplicate
an unverified prior review or remove an unverified worktree.
Start exactly one poller from the watcher checkout with --reviewer <reviewer>
--poll-interval 180. Persist its PID, terminal handle, and log path. Inspect
poll logs for errors; quiet output and exit 0 do not establish success.

Consume ACTION_REQUIRED while isolated PR children are running. Persist each
payload and child record before dispatch. Preserve the existing journal record
for repeated delivery of the same comment ID. Record distinct comments ignored
because their PR is in flight with their reason and covering comment ID.
Use the Orchestrator and Child protocols, including required review skills,
permissions, reactions,
verification, pushes, and one summary linked to the triggering comment.
Capture each child's initial pwd -P and validate worktree isolation before
checkout. Poll child completion without blocking the GitHub monitor.
You remove each child's worktree in a finally path and verify it is absent.
Record summary URL, cleanup, final reaction, and complete/failed state.

Maintain status.json with coordinator/poller identity, latest successful
poll, recovery result, pending and in-flight requests, and failures.
When probe.request appears, copy its value to probe.handled and record the
handoff probe in status.json. This local probe causes no GitHub actions.
Keep your overall turn active: no final answer while watching. Use waits
of at most 60 seconds; consume events and check stop.request between waits.
When stop.request appears, stop your poller, finish or safely stop your
children, clean up their worktrees, record stopped status, then end.
```

The dispatch journal lives beside the watcher state, so it survives replacement of a run directory. `status.json` and probe files belong to this run. A process exit, poll error, or failed approval is a failed handoff until repaired; do not report it as an idle, healthy watcher.

## Stop and recover

Write `stop.request` in this run's directory. Wait for `status.json` to report `stopped`, confirm its poller and coordinator exited, and verify its child worktrees are gone. Keep the journal and logs for recovery. If the coordinator crashes or fails to stop, verify the identities of its recorded processes, stop that run's coordinator and poller, finish or safely stop its children, and perform the skill's cleanup before launching a replacement. Resume only unfinished, reconciled records; skip completed and intentionally ignored requests. If ownership or prior effects cannot be verified, preserve the existing record and report the blocker. Never kill or remove another run's resources.
