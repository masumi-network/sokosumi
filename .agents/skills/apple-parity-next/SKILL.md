---
name: apple-parity-next
description: Take the next Apple chat parity row from PARITY.md to a merged PR in this session.
disable-model-invocation: true
---

# Apple parity: next row

One fresh session carries one row of `apps/apple/PARITY.md` from `Todo` to merged. `PARITY.md` is the source of truth for scope, order and state; `apps/apple/VISION.md` ("Iteration loop") and `apps/apple/AGENTS.md` hold the rules. Read all three before step 1, the Resume checkpoint first.

**Stop and ask the user** when a PR is closed unmerged, web is ambiguous, a Core API or Ably capability is missing, a project/entitlement/dependency change would be needed, or `git fetch`, signing or push fails. Report the exact error once; never retry in a loop.

## Steps

1. **Sync.** `git fetch origin main`. Done when fetch succeeds.
2. **Find open work.** An open PR on a `claude/apple-parity-*` branch is this session's row: go to step 5 with it. Done when you know whether one is open.
3. **Pick the row.** The first Work order entry whose status is exactly `Todo` and whose dependencies are `Done` or `Merged`. Never take M6. No `Todo` left: open one docs PR marking the last row `Done`, then stop.
4. **Dispatch one subagent** (`general-purpose`, `isolation: worktree`, background) with the brief below, filled in for the row. When it reports, relay to the user: the PR link, the render, the deviations from web, and anything that needs their decision. Show the render with `SendUserFile`.
5. **Shepherd the PR until it merges.** Watch CI with a Monitor. Notify the user when the PR is up and when CI is green. For each review:
   - verify every claim against the code;
   - push valid fixes as one commit, resuming the subagent that owns the worktree;
   - answer once with technical reasoning;
   - never re-request review.

   Resolve conflicts by merging `main`, never by rebasing or force-pushing. Regenerate `openapi.json` with `scripts/update-core-api.py`; never hand-merge it. Re-run a CI job only when its log shows an infrastructure flake or a known-flaky test listed in the Resume checkpoint. Done when the PR is merged.

## Subagent brief

Fill in every item. Name concrete files and SHAs, and keep claims about web behaviour out of the brief.

- **Base**: the exact `origin/main` SHA and the branch `claude/apple-parity-<row>-<slug>`.
- **Read first**: root `AGENTS.md` and the `docs/agents/` files it requires for code work, `apps/apple/AGENTS.md`, `VISION.md`, the PARITY sections for the row, its dependencies and its neighbours, any ADR the row cites, and the app-scoped `swiftui-expert-skill`.
- **Setup**: `pnpm install --frozen-lockfile` before the first commit, so the hooks run.
- **Audit**: name the web and Core files to read at the current `main` SHA, and phrase web behaviour as numbered questions for the subagent to answer with file:line. Row text is a snapshot, so the subagent corrects stale row text in the same PR. It stops and reports only when web itself is unclear or a stop condition above applies.
- **Split**: child rows (`<row>1`, `<row>2`) only when the audit shows independent features. Record both in PARITY and implement one.
- **Build**: portable model and networking in `Packages/` with UI-free tests using fixed IDs and time; native SwiftUI in the app; reuse the existing seam. Native Mac affordances win over copying web markup: keep clickable controls and native toolbar items, and record each deviation in PARITY.
- **Tests first**: every new test is shown to fail before the fix. Render fixtures host the view over the window background with an opaque-footer guard. Save a combined light/dark PNG at an absolute path, and commit a half-size copy under `apps/apple/docs/images/`.
- **PARITY**:
  - this row set to `In review — [#<PR>](…)`, with corrected text;
  - the previous row set to `Done`, with its merge date and follow-up SHAs, keeping its unverified list;
  - a slice section;
  - a Resume checkpoint bullet;
  - the Work order advanced.
- **Done**: the checks in VISION.md's "Iteration loop" pass, with exact commands and counts recorded. Re-run the known-flaky tests; never disable them. Close any test host and delete derived data afterwards.
- **Delivery**:
  - one Conventional Commit; a draft PR whose title equals the subject;
  - re-check the PR number right before committing the PARITY edit;
  - never rebase or force-push; after pushing, fetch and confirm the remote has the commit;
  - no Linear issues, no review requests;
  - never end a turn with its own background command still running.
- **Report**: the PR URL, the SHA, the audit answers, what changed, the verification counts, the render path, the interactions it did not exercise, and any stop reason.
