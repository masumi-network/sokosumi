---
name: apple-parity-next
description: Take the next Apple chat parity row from PARITY.md to a merged PR in this session.
disable-model-invocation: true
argument-hint: "[row id]"
---

# Apple parity: next row

One fresh session carries one row of `apps/apple/PARITY.md` from `Todo` to merged. `PARITY.md` is the source of truth for scope, order and state; `apps/apple/VISION.md` ("Iteration loop") and `apps/apple/AGENTS.md` hold the rules. Read all three before step 1, the Resume checkpoint first. Run these steps once.

**This session's row** is the row id the user passed (`/apple-parity-next 24h`), or, without one, the row step 2 or 3 finds. Up to two sessions can run in parallel, each on its own row; a session touches only its own row's PR and leaves the others alone.

**Stop and ask the user** when a PR is closed unmerged, web is ambiguous, a Core API or Ably capability is missing, a project/entitlement/dependency change would be needed, or `git fetch`, signing or push fails. Report the exact error once; never retry in a loop.

## Steps

1. **Sync.** `git fetch origin main`. Done when fetch succeeds.
2. **Find open work.** A row branch is `claude/apple-parity-<id>-<slug>` with `<id>` starting with a digit.
   - With a row id: an open PR on that row's branch is this session's PR; go to step 5 with it. That row's newest PR closed unmerged: stop and ask.
   - Without one: exactly one open row PR is this session's PR; go to step 5. More than one: stop and ask the user which row, or to start with a row id.

   Done when you know whether this session's row already has an open PR.
3. **Pick the row.** With a row id: that row, when its status is exactly `Todo` and its dependencies are `Done` or `Merged`; otherwise stop and report why. Without one: the first Work order entry that qualifies and has no open row PR. Never take M6. No `Todo` left: open one docs PR marking the last row `Done`, then stop.
4. **Dispatch one subagent** (`general-purpose`, `isolation: worktree`, background) with the brief below, filled in for the row. When it reports, relay to the user: the PR link, the render, the deviations from web, and anything that needs their decision. Show the render with `SendUserFile`.
5. **Shepherd the PR until the user merges it.** Watch CI with a Monitor. Notify the user when the PR is up and when CI is green. For each review:
   - verify every claim against the code;
   - push valid fixes as one commit from the subagent that owns the worktree. Resume this session's subagent when it is still alive; otherwise dispatch a new one (`general-purpose`, `isolation: worktree`, background) onto the open PR branch. It fetches that branch and merges `origin/main` before the push;
   - answer once with technical reasoning;
   - never re-request review.

   Resolve conflicts by merging `main`, never by rebasing or force-pushing. Regenerate `openapi.json` with `scripts/update-core-api.py`; never hand-merge it. Re-run a CI job only when its log shows an infrastructure flake or a known-flaky test listed in the Resume checkpoint. Done when the user has merged the PR.

## Subagent brief

Fill in every item. Name concrete files and SHAs, and keep claims about web behaviour out of the brief.

- **Base**: the exact `origin/main` SHA and the branch `claude/apple-parity-<row>-<slug>`.
- **Read first**: root `AGENTS.md` and the `docs/agents/` files it requires for code work, `apps/apple/AGENTS.md`, `VISION.md`, the PARITY sections for the row, its dependencies and its neighbours, any ADR the row cites, and the app-scoped `swiftui-expert-skill`.
- **Setup**: `pnpm install --frozen-lockfile` before the first commit, so the hooks run.
- **Audit**: name the web and Core files to read at the current `main` SHA, and phrase web behaviour as numbered questions for the subagent to answer with file:line. Row text is a snapshot, so the subagent corrects stale row text in the same PR. It stops and reports only when web itself is unclear or a stop condition above applies.
- **Split**: child rows (`<row>1`, `<row>2`) only when the audit shows independent features. Record both in PARITY and implement one.
- **Build**: portable model and networking in `Packages/` with UI-free tests using fixed IDs and time; native SwiftUI in the app; reuse the existing seam. Native Mac affordances win over copying web markup: keep clickable controls and native toolbar items, and record each deviation in PARITY.
- **Tests first**: every new test is shown to fail before the fix. Render fixtures host the view over the window background, so nothing renders transparent. Save a combined light/dark PNG at an absolute path, and commit a half-size copy under `apps/apple/docs/images/`.
- **PARITY**:
  - this row set to `In review — [#<PR>](…)`, with corrected text;
  - every row whose PR has merged but that still reads `In review` set to `Done`, with its merge date and follow-up SHAs, keeping its unverified list;
  - a slice section;
  - a Resume checkpoint bullet;
  - the Work order no longer leading with this row.

  A parallel session edits the same file, so merge `origin/main` and resolve PARITY conflicts by keeping both sides' rows and bullets.
- **Done**: the checks in VISION.md's "Iteration loop" pass, with exact commands and counts recorded. Re-run the known-flaky tests, which fail more often while another session builds; never disable them. Close any test host. Keep the worktree's derived data until the PR merges, so review fixes rebuild incrementally.
- **Delivery**:
  - the slice lands as one Conventional Commit, and each later review fix as one more; a draft PR whose title equals the slice commit's subject;
  - re-check the PR number right before committing the PARITY edit;
  - never rebase or force-push; fetch and merge `origin/main` before a push onto an existing PR branch; after pushing, fetch and confirm the remote has the commit;
  - no Linear issues, no review requests;
  - never end a turn with its own background command still running.
- **Report**: the PR URL, the SHA, the audit answers, what changed, the verification counts, the render path, the interactions it did not exercise, and any stop reason.
