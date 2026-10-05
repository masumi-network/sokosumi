---
name: address-review
description: Use when addressing review feedback on your pull request (unresolved review threads, review summaries, or PR comments from people or review bots) before changing code for it.
argument-hint: "[<pr-number>]"
---

# Address review

Turn review feedback into verified fixes and a reply for every finding. Each finding is a **hypothesis**: the reviewer may be right, wrong, or right about a different problem. The code decides.

## Done

Every finding has a verdict, every valid fix is pushed in one push, and every finding has a reply.

## 1. Collect findings

Read all three places reviewers write. `owner`, `repo` and `n` come from `gh pr view --json url`:

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F n=<n> -f query='
query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
  reviewThreads(first:100){nodes{id isResolved isOutdated path line
    comments(first:50){nodes{databaseId author{login} body url}}}}}}}'
gh pr view <n> --json reviews,comments
```

A finding is an unresolved thread, a review body with content, or a PR comment asking for a change. An outdated thread still counts: the line moved, the concern may not have. A thread whose last comment is your own reply, waiting on the reviewer, is settled.

## 2. Verdict per finding

Read the code at the cited path, and reproduce behavioural claims with a test or command. Then give one verdict:

- **valid**: the problem exists. Fix it.
- **wrong**: the premise is false or the code already handles it. The reason cites the file and line, or the output.
- **out of scope**: real, but belongs elsewhere. Name where.
- **unclear**: the ask is ambiguous, or it is a product or design decision. Ask the user and leave it open.

Evidence decides, not the reviewer's confidence. A suggestion that conflicts with the repo's documented rules (`AGENTS.md`, coding standards) loses to the rules.

## 3. Fix and push once

Fix every valid finding, run the checks that cover the changed files, commit with a Conventional Commit subject, and push once. Each push can start CI, a re-review, or an auto-merge of a half-fixed state.

## 4. Reply

Threads: reply inside the thread. `databaseId` is the thread's first comment; GitHub accepts replies only there.

```bash
gh api repos/<owner>/<repo>/pulls/<n>/comments/<databaseId>/replies -f body='Fixed in <sha>: <what>.'
```

Resolve only threads you fixed. Wrong and out-of-scope threads get the reason and stay open, so the reviewer has the last word.

```bash
gh api graphql -F id=<threadId> -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}'
```

Review bodies and PR comments: one `gh pr comment <n> --body-file <file>` answering each finding.

## 5. Report

Tell the user three lists: fixed (with sha), declined (with reason), waiting on them.
