# Evals

Fixed Soko Bot and CMO (Cuso) cases with checks, run against what is deployed. Every change to how a bot behaves is measured with them before it merges, and main is measured every day. The reference point is always a PR: each run records the commit, its PR, and the versions and models the bots ran on.

## The rule

- **A PR that changes Soko Bot or Cuso behaviour shows an eval run in its Evidence.** That covers a prompt, a skill, a tool or its description, a version, a model, the classifier, the context packet, or a Core check the bot's answers pass through (claim check, post checks, plan review). Paste `sokosumi evals show RUN_ID --markdown`.
- **A new tool gets a case.** `apps/core/src/services/evals/eval-cases.test.ts` fails when a capability is in no case's `tools`, `anyTools` or `forbiddenTools`. Its `NOT_YET_COVERED` list only shrinks.
- **A regression is fixed or explained before merge.** "Flaky" means the case already failed in recent daily runs; a "regressed" case passed every recent daily run.

## Where runs happen

| Run              | Where                                                      | Started by                              |
| ---------------- | ---------------------------------------------------------- | --------------------------------------- |
| Daily            | mainnet production (main), 04:00 UTC                       | `/sync/evals`, once a day               |
| After a merge    | mainnet                                                    | Admin → Evals → Run evals, or the CLI   |
| While developing | preprod, a PR preview (`/deploy preprod`), or a local Core | Admin → Evals, or the CLI with `--tick` |

The daily run is the baseline every run is compared with. A run on a preview or a local Core is compared with the latest daily run on that environment's database, so preprod and local runs need a first full run of their own before the comparison means anything.

## Running them

```bash
sokosumi evals cases                                   # every case, by suite and area
sokosumi evals run --suite cmo --repeats 1 --wait      # one suite, once, wait for the report
sokosumi evals run --cases ambiguous-request,chat-post --wait --tick   # no cron here: also tick
sokosumi evals run --soko-bot-version v34 --wait       # try a version before promoting it
sokosumi evals show RUN_ID --markdown                  # the table for the PR
sokosumi evals list                                    # recent runs and scores
```

`--preprod` or `--api-url` picks the deployment, as for every CLI command. Runs queue: the lanes run one run at a time. The admin page (Admin → Evals) shows the trend per PR, each run's cases worst first, and each case's checks, judge verdict, answer and tools beside the daily run before it.

The daily run runs each case once. A run you start runs once too unless you ask for `--repeats 2` or `3`. In development, run the few cases your change touches while you iterate, then the suite your change touches with three repeats before you open the PR. A case that regressed in the daily run on one repeat may be chance: run it with three repeats before chasing it.

## How a run works

- **Lanes.** Repeat N runs in lane N: its own eval organization (`sokosumi-evals-N`) with an owner (Robin Keller), two teammates (Hannah Weber does research, Alex Kim writes), the Projects "Sokosumi Marketing" (an X account) and "utxo AG Outreach" (a LinkedIn account), a newsletter, a "Launch team" room, a Soko Bot and a Cuso. `eval-lanes.service.ts` makes them on first use and resets the Soko Bot's world before its first case.
- **Order.** Soko Bot cases run in order, and later ones build on what earlier ones made: the Coworker events act on the Task the first case created. A case with `setup` starts from a clean slate.
- **Scoring.** A scenario passes when every deterministic check passes and the judge does not say "fail". CMO research and strategy cases check the Brand Brain and the plan against what the brand really sells (`cmo-brand-checks.ts`, shared with `cmo:lab`).
- **Outcomes.** Each case is regressed, fixed, flaky, failing, passing, error (could not run) or skipped (needs something the environment lacks, such as a connected mailbox), from its repeats and the last daily runs (`lib/evals/eval-compare.ts`).

## What keeps mainnet safe

Eval bots run on mainnet, so nothing they do may leave their organization (`lib/evals/eval-guard.ts`):

- Global Coworkers are not offered to them and cannot be assigned or asked: they would do real, paid work.
- Hires, newsletter subscriber adds, publishing a post now, ad campaigns and comment replies answer as if they worked without running. The tool call is still recorded, so cases still check whether the bot tried. Scheduling runs for real, because a month counts a post as made once it is scheduled; the publisher never picks up a post on an eval account.
- The stand-in social accounts carry an `eval:` Composio id, and the social syncs skip them.
- Their bots are paused for unprompted work between runs, and eval turns start with `lab:`, which keeps them out of allowances and fleet statistics.

Credits: each lane's organization is topped up to 2,000 free credits before a run.

## Adding a case

- **Soko Bot:** add a scenario to `SOKO_BOT_SCENARIOS` in `packages/soko-bot/src/scenarios.ts` (prompt or trigger, `expect` checks, a rubric for the judge) and its area in `SOKO_BOT_AREAS` (`eval-cases.ts`). Write it against the lane's world above, and put it where the state it needs exists.
- **CMO chat:** add to `CMO_SCENARIOS`; it runs on the lane's Cuso, after the CMO research and strategy cases.
- **CMO research or strategy:** add the brand to `fixtures/cmo-brands.json` and to `RESEARCH_BRANDS` or `STRATEGY_BRANDS` in `eval-cmo-cases.ts`. A strategy case needs the brand's Brand Brain in `fixtures/cmo-brand-brains.json`: run its research case once and copy the saved Brand Brain in.

## Cuso versions

Cuso changes ship on a version, as Soko Bot's do. To release one, add `cmo-vN` to `SOKO_BOT_PRODUCT_VERSIONS` and run the CMO suite with `--cuso-version cmo-vN`. When nothing regresses, point `CMO_SOKO_BOT_VERSION_ID` at it so new hires get it. Lookups accept every Cuso version (`CMO_SOKO_BOT_VERSION_IDS`). Moving existing Cusos onto a new version has no admin path yet.
