# Owner benchmark: world validation (B2)

- Date: 2026-11-27
- What: the first [world validation](README.md#world-validation-b2) of the owner benchmark. It runs a do-nothing agent and a scripted reference run, twice in a row, with no model calls.
- Driver: `ownerbench:world-check`, #8459 (`714facd1bc`)
- World fixes:
  - ownerbench: #8432 (images, seeded files)
  - loopcore: #8470 (`6151c179e6`, account naming, Files tables)
  - cusoctx: branch `cusoctx/b2-cuso-accounts` (`93742a6370`, Cuso's connected accounts)
- Pin: ownerbench `ownerbench/b2-pin` `35afb6e542`, local Postgres
- Sets: dev, 18 journeys × 2 passes × do-nothing and reference. Held-out, 10 journeys, run privately; totals only here.

## Results

|                                             | Before the fixes                  | After the fixes                                              |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Dev journeys whose reference run passes     | 8 of 18                           | 16 of 18                                                     |
| Dev journeys that pass a do-nothing agent   | 0 of 18                           | 0 of 18                                                      |
| Dev journeys whose second pass differs      | 0 of 18                           | 0 of 18                                                      |
| Dev journeys with work left after the reset | 18 of 18 (an earlier Files table) | none among the 16 that pass (a leftover counts as a failure) |
| Held-out (run r2, totals only)              | not run                           | 10 of 10 clean                                               |

- **Before:** main with the driver (#8459 `71b35bbd77`), loopcore's local run. That environment had no studio image storage, so the three image journeys couldn't make images. ownerbench's own pre-fix run, which had image storage, counted 10 of 18.
- **After:** ownerbench's pin `35afb6e542`. Two caveats:
  - The two journeys still failing on the pin, `owner-cuso-change-plan` and `owner-cuso-launch`, pass both reference passes on cusoctx's `93742a6370`, which isn't on this pin. That result is from cusoctx's run on its own database.
  - The pin gave the two account-naming journeys an exact `@handle`. Codex noted that this validates a diagnostic variant, not the owners' wording. The original wording, with `owner-pdf-to-x-posts` as two steps, passes on #8470 `6151c179e6` (loopcore's local run, both passes, do-nothing fails). Before the decision suite counts these two as fixed, they need one reference result on the same revision as the rest.
- **Held-out clean** means no do-nothing passes, no reference fails, no invalid runs, no differing passes and no leftovers. The driver on this pin records one reset per run, so reset isolation on every held-out repeat isn't verified yet.

## Dev journeys

| Journey                      | Before                   | Cause                                                                                                                                                         | Fix                                                                                                                               | Owner             |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| owner-no-x-account           | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-site-to-newsletter     | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-stale-schedules        | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-codepat-busy           | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-weekly-report-schedule | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-cuso-pricing-page      | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-cuso-report-then-act   | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-cuso-ambiguous-more    | pass                     |                                                                                                                                                               |                                                                                                                                   |                   |
| owner-pdf-to-x-posts         | fail                     | "for Sokosumi" names no account the way Core counts one (an `@handle`, id or whole Project name), and two X accounts fit, so Core refuses the drafts and asks | Coordinator: keep Core's rule. The journey is two graded steps: ask once and draft nothing, then three drafts on the owner's pick | loopcore, #8470   |
| owner-which-x-account        | fail                     | Step 1 forbade the refused draft that opens Core's account question, and step 2's "The Sokosumi one." isn't an exact name                                     | Step 1 checks that nothing was made and allows that refusal. The answer goes through Core's account question                      | loopcore, #8470   |
| owner-investor-table         | pass, then fail on rerun | The Soko Bot lane reset kept Files tables, and the old table's retry key refused the rerun's `create_table`                                                   | The reset deletes the lane workspace's tables; their retry keys cascade                                                           | loopcore, #8470   |
| owner-images-redo            | fail                     | No studio image storage on a local run                                                                                                                        | `EVAL_LOCAL_STUDIO_STORE_DIR` stands in for the studio store locally, never on Vercel                                             | ownerbench, #8432 |
| owner-codepat-daily-post     | fail                     | Same storage gap                                                                                                                                              | Same                                                                                                                              | ownerbench, #8432 |
| owner-research-to-linkedin   | fail                     | Same storage gap                                                                                                                                              | Same                                                                                                                              | ownerbench, #8432 |
| owner-cuso-customer-story    | flaky                    | The seeded PDF was sometimes "still being processed": a rewritten pathname answered 404 for seconds and sent extraction into backoff                          | Each journey writes the file to a fresh pathname and waits for its extraction before the first turn                               | ownerbench, #8432 |
| owner-cuso-launch            | fail                     | Cuso's project had no connected account, so a dated post failed with "A social connection is required to schedule a post"                                     | Cuso's journeys start with connected stand-in accounts for X, LinkedIn and each network in the plan                               | cusoctx           |
| owner-cuso-change-plan       | fail                     | Same: moving a post's date needs `schedule_social_post`, which needs a connection                                                                             | Same                                                                                                                              | cusoctx           |
| owner-cuso-youtube           | fail                     | Same: an unconnected post is always X, so "two networks" can't be met                                                                                         | Same                                                                                                                              | cusoctx           |

## Weak spots B2 found in the checks, still open

- **Multi-step journeys:** in four of them, do-nothing stops at "Step could start", so their later steps' checks aren't tested for looseness. These are codepat-daily-post, codepat-busy, weekly-report-schedule and research-to-linkedin.
- **`owner-cuso-ambiguous-more`:** do-nothing fails it only on "Asks a question", so a bot that always asks something generic passes every code check, and only the judge is left.

## Rules a correct bot follows (what the reference scripts had to learn)

- **Two accounts, none named exactly:** a refused draft opens Core's account question, the bot asks, and the answer passes the question's id and the chosen account.
- **After a web read**, a turn may edit its own drafts but not cancel a post (web taint).
- **A Coworker's wake turn** may draft and make images only through the owner's `followUp` and `followUpAllows`.
