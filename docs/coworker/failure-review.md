# Weekly failure review

Every Monday CodePat reads what failed in production last week and opens draft
PRs that fix the biggest causes. This page is the contract for the data route
and the job's instructions. CodePat's Sokosumi schedule points here.

## The route

`GET https://api.sokosumi.com/v1/admin/failure-review?since=&until=`

- Read-only. Window defaults to the 7 days before now, at most 31 days. Every
  group also carries `previousCount`, its count in the window of the same
  length before, so `count - previousCount` is the week-over-week change.
- Each section is a list of groups: `key` (the cause), `count`,
  `previousCount`, and at most 3 `examples` (`id`, `at`, `refs` with turn, bot,
  schedule, project or run ids). At most 15 groups per section, biggest first.
- Sections: `turns` (failed, cancelled, or ORPHANED past their deadline, by
  status, kind, version, error), `mentions`, `replyChecks` (replies held back
  unchecked, CLARIFY reroutes with Jev's wanted route), `toolCalls`, `posting`
  (publish attempts and posts that ended FAILED or MISSED), `media`,
  `schedules` (failed runs, schedules a bot disabled or deleted), `evals`
  (failing cases). `cmoMonths` lists live Cusos whose month is stuck, blocked,
  unreadable or has failed pictures right now, with the project name.
- Eval lanes are left out of every section except `evals`.
- It quotes nothing: error texts are cut to their first line with quoted
  text, URLs, emails, ids and numbers removed. No prompt, post, mail or
  message is in the answer.
- `notCovered` says what the route cannot see: replies withheld for claiming
  an unconfirmed change are only in the logs (message
  `Withheld a Soko Bot reply`), and errors that never reach a row are in
  Vercel logs and Sentry.

Code: `apps/core/src/services/failure-review.service.ts`.

## Access

Platform admins can call it with any sign-in. A coworker can call it with its
own API key (no `X-Context-*` headers) only when its id is in
`FAILURE_REVIEW_COWORKER_IDS` on Core. The key gets this one route; every other
admin route still answers 403.

To grant CodePat (coworker `01a0abc4-784e-7261-ab22-0ae0706f6fa3`):

1. Vercel, project `sokosumi-core-mainnet`, Settings, Environment Variables.
2. Add `FAILURE_REVIEW_COWORKER_IDS` = `01a0abc4-784e-7261-ab22-0ae0706f6fa3`
   for Production.
3. Redeploy production (Deployments, latest, Redeploy) so Core reads it.

Remove the variable to take the access away.

## The weekly job (CodePat)

1. Call the route with the default window. Read last week's Vercel runtime
   logs of `sokosumi-core-mainnet` and `sokosumi-cmo` for errors the route
   names in `notCovered`, and group them the same way.
2. Rank causes by impact: owner-visible harm first (a Cuso month stuck, posts
   not sent, replies lost), then count and growth. Skip a cause with fewer
   than 3 rows in the week unless it lost an owner's work or a post.
3. For the top 3 causes, find the class of failure in the code and fix it,
   one draft PR each on `masumi-network/sokosumi`:
   - the fix is a Core check, a skill or prompt edit, or a tool fix;
   - it comes with an eval case (docs/agents/evals.md) or a regression test
     that fails before the fix;
   - follow AGENTS.md: branch off newest `main`, Conventional Commit subject,
     PR body via `/pr`, draft. Never merge.
4. If a cause already has an open PR from an earlier week (search open PRs
   for the cause key), update that PR instead of opening another.
5. Post one short report as a comment on the week's Task: for each cause the
   key, this week's and last week's counts, and the PR link; then what you did
   not fix and why (too few rows, needs a decision, outside the repo).

Not available to CodePat yet: Sentry (no token) and the evals CLI (needs a
platform admin). The route's `evals` section covers the week's failing cases.
