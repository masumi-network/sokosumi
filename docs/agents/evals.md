# Evals

Fixed Soko Bot and CMO (Cuso) cases with checks, run against what is deployed. Every change to how a bot behaves is measured with them before it merges, and main is measured every week. The reference point is always a PR: each run records the commit, its PR, and the versions and models the bots ran on.

## The rule

- **A PR that changes Soko Bot or Cuso behaviour shows an eval run in its Evidence.** That covers a prompt, a skill, a tool or its description, a version, a model, the classifier, the context packet, or a Core check the bot's answers pass through (claim check, post checks, plan review). Paste `sokosumi evals show RUN_ID --markdown`.
- **The PR also commits the run as a file.** `sokosumi evals show RUN_ID --summary-md --slug SLUG` writes `docs/evals/runs/YYYY-MM-DD-SLUG.md` from the run. Fill in its "Why the failures happened" and "Verdict" sections, commit it in the PR that needed the run, and link it from the PR's Evidence. Local databases and scratchpads disappear; this file is what stays. Format and template: [`docs/evals/runs/README.md`](../evals/runs/README.md).
- **Held-out runs report aggregates only.** For the owner benchmark's held-out set, a PR, commit or shared report contains only these per-set numbers:
  - passed journeys (pass^3: every repeat passed), pass^1 and steps right, baseline vs candidate
  - lost passes (journeys that passed on the baseline and fail on the candidate)
  - token coverage
  - the verdict

  Never paste `sokosumi evals show` output or commit a summary file for a held-out run. Case ids, titles, failed checks, observed values and judge notes stay with ownerbench.
- **A new tool gets a case.** `apps/core/src/services/evals/eval-cases.test.ts` fails when a capability is in no case's `tools`, `anyTools` or `forbiddenTools`. Its `NOT_YET_COVERED` list only shrinks.
- **Local and agent-run evals are judged by Claude Code.** Set `SOKO_BOT_JUDGE_RUNNER=claude-code` in `apps/core/.env`: the judge then runs through the local `claude` CLI on Patrick's Claude Code subscription, and the run records it as `claude-code:<model>`. The weekly run and every run on mainnet, preprod or a preview keep the Gateway judge; Core refuses `claude-code` on Vercel. The bots under test always run on their real models.
- **Local and agent runs use the ChatGPT plan by default: `pnpm evals:local --plan`.** See [On your own ChatGPT plan](#on-your-own-chatgpt-plan). Run only the cases the change touches, one repeat each. Repeat a case three times only when it failed, to tell chance from a regression; never rerun a suite to settle one case. Run one plan run at a time per machine.
- **A PR's Evidence may be a plan run.** Run the touched cases on the final commit, and state the run's environment, `local-chatgpt-plan`, beside the table.
- **The Gateway is for the final cost and cache proof only.** Run on the Gateway (mainnet or without `--plan`) only for a new bot version's final cost and cache proof, or for a case that cannot run on the plan. Each Gateway run costs real tokens from a shared budget, and an empty team budget fails customer turns. So before every Gateway run:
  - Check the team and evals key budgets with `vercel ai-gateway budgets ls` (amounts only).
  - Never start one while another Gateway run is going.
  - Run at most one full suite per bot version (about $12 for CMO's 52 cases), on the PR that adds the version.
- **Don't overfit to the benchmark.**
  - Fix general mechanisms (the loop, hand-offs, permissions, verification, asking when a request is ambiguous), never a benchmark journey's wording.
  - No prompt text, rule or check may name a benchmark case, account, Coworker or phrasing.
  - Core rules are only for invariants that hold for any request; everything else stays model judgement guided by skills.
  - The owner benchmark keeps a held-out set that nobody iterates on, described with the benchmark. A version must hold its bar on both sets.
  - Reviewers flag any change that only makes sense for one journey.
- **A regression is fixed or explained before merge.** "Flaky" means the case already failed in recent weekly runs; a "regressed" case passed every recent weekly run.

## Where runs happen

| Run              | Where                                             | Started by                              |
| ---------------- | ------------------------------------------------- | --------------------------------------- |
| Weekly           | mainnet production (main), Monday 04:00 UTC       | `/sync/evals`, once a week              |
| After a merge    | mainnet                                           | Admin → Evals → Run evals, or the CLI   |
| While developing | a PR preview (`/deploy mainnet`), or a local Core | Admin → Evals, or the CLI with `--tick` |

The weekly run is the baseline every run is compared with. A run on a preview or a local Core is compared with the latest weekly run on that environment's database, so preview and local runs need a first full run of their own before the comparison means anything. Preprod previews are gone: the old Preprod is frozen and `/deploy preprod` deploys nothing.

## Running them

```bash
sokosumi evals cases                                   # every case, by suite and area
sokosumi evals run --suite cmo --repeats 1 --wait      # one suite, once, wait for the report
sokosumi evals run --cases ambiguous-request,chat-post --wait --tick   # no cron here: also tick
sokosumi evals run --soko-bot-version v34 --wait       # try a version before promoting it
sokosumi evals show RUN_ID --markdown                  # the table for the PR
sokosumi evals show RUN_ID --summary-md --slug cmo-v8  # the run file for docs/evals/runs (--out PATH to choose)
sokosumi evals list                                    # recent runs and scores
```

`--preprod` or `--api-url` picks the deployment, as for every CLI command. Runs queue: the lanes run one run at a time. A Core starts and advances only runs of its own environment, and waits while a run of another environment is running in the same database, so a preview or agent database forked from production never runs production's copied runs; a copied run that is still running times out there like any stuck run. Each run executes with the code of whichever Core ticks it, so when several local Cores share one database, tick from one of them only, and from a checkout whose schema matches that database. The admin page (Admin → Evals) shows the trend per PR, each run's cases worst first, and each case's checks, judge verdict, answer and tools beside the weekly run before it.

The weekly run runs each case once, judged cases twice. A run you start runs once unless you ask for `--repeats 2` or `3`. In development, run the few cases your change touches while you iterate, then the suite your change touches with three repeats before you open the PR. A case that regressed in the weekly run on one repeat may be chance: run it with three repeats before chasing it.

### On your own ChatGPT plan

Local runs can use your own ChatGPT plan (OpenAI's "Sign in with ChatGPT" plan usage) instead of the AI Gateway. Use it to check cases while you work. A plan run sends nothing to the Gateway except real Jev:

- OpenAI models run on the plan as themselves.
- **Real Jev is on by default for `evals:local --plan`** (`SOKO_BOT_PLAN_REAL_JEV=1`; set it to `0` to opt out). Production routes with Jev, and the stand-in routes differently, so stand-in routing can't tell how a version behaves in production. Jev's typed questions (routing, the claim check, agent fit, mail triage, the Cuso context organizer and other `evaluateWithJev` calls) then go to `typesafe-ai/jev` through the Gateway with your `.env` key, with Jev's normal 3.5 s (organizer 4 s) timeouts. Only Jev's decision model gets through the plan guard; every other Gateway request still fails.
  - If real Jev fails (a Gateway budget stop, or more than a tenth of its last calls failing or timing out), the run keeps going: Jev questions use the stand-in for 30 minutes, then real Jev is tried again. Each owner-benchmark result says which Jev answered it (`output.jev`: `real` or `stand-in`), and `evals:local` prints the real Jev call count, cost and any stand-in windows at the end. Rerun the stand-in results with real Jev before using them for a decision.
- Without real Jev, every other model (Gemini and Claude checks) and Jev's typed questions run on the plan's stand-in, `gpt-6-luna`. Stand-in Jev answers are labelled `chatgpt-plan-jev` in the ledger. With real Jev, only the non-Jev models do.
- Embeddings for in-process comparisons (repeat checks) are computed locally from shared wording (`chatgpt-plan/local-token-overlap`).
- Searches against stored Gateway vectors don't use those local vectors, and a plan run never stores them:
  - contact search matches by text only
  - style references rank by usability
  - contacts are not re-embedded
- The reference layout and style checks run on the plan's stand-in.
- The judge runs on Claude Code unless you set `SOKO_BOT_JUDGE_RUNNER`. Stored results name the model that actually ran (`chatgpt-plan:<slug>`, `claude-code:<model>`).
- Any other call to the Gateway fails with "A ChatGPT plan run tried to call the AI Gateway". Nothing is sent.

All of this applies whenever plan mode is on, whether you passed `--plan` or only set `SOKO_BOT_LOCAL_CHATGPT_PLAN=1`. A plan run with real Jev records its environment as `local-chatgpt-plan-real-jev`, with the label "local, ChatGPT plan + real Jev". One with the stand-in records `local-chatgpt-plan`, with the label "local, ChatGPT plan (approximate)". Each is compared only with runs of its own environment, never with the other or with the daily production runs. Real Jev's Gateway cost counts against the local key's budget, so the hard stops for local Gateway spend apply. Plan runs from before this change (environment `local`, label "local, OpenAI on ChatGPT plan") still used real Jev and Gemini checks, so they form their own group.

Stand-in answers, check results and similarity scores are approximate, so pass rates can differ from a Gateway run.

```bash
pnpm chatgpt-plan:login                     # once per machine: sign in with YOUR ChatGPT account in the browser
pnpm chatgpt-plan:status                    # who is signed in, which models the plan has
pnpm evals:local --plan --cases ambiguous-request,cmo-brand-fit
pnpm evals:local --plan --suite cmo --cuso-version cmo-v23
pnpm chatgpt-plan:logout                    # revoke and forget the session
```

- `evals:local` runs the cases in its own process against the database in `apps/core/.env`. It needs no Core server and no CLI login. Point it at a database of your own: runs share one queue, and it refuses to start while another run is queued or running there. Without `--plan` it runs the same cases on the Gateway.
- The session is per machine, in `~/.sokosumi/chatgpt-plan.json` (mode 0600), outside every checkout. Tokens are never printed. Each person signs in with their own account. Never share a session file.
- `SOKO_BOT_LOCAL_CHATGPT_PLAN=1` turns the switch on for any local Core process (`evals:local --plan` sets it). Core refuses the flag on Vercel and in production.
- When the plan's usage limit is hit, the call fails with "ChatGPT plan usage limit reached". Nothing falls back to the paid Gateway. Wait for the limit to reset (ChatGPT settings, Usage), then run again. On Plus the 5-hour limit is shared with Codex and every other app on your plan.
- A plan run is enough Evidence for ordinary changes. A default-deciding run, such as a new version's final cost and cache proof or a model change, stays on the Gateway (see [The rule](#the-rule)), because the plan differs from production:
  - Cost and cache numbers are zero or missing.
  - The plan ignores the output cap (`max_output_tokens`), `temperature` and prompt-cache retention.
  - Every request is stateless (`store: false`).
  - Reasoning effort is set to `medium` unless the caller sets one. Left unset, the plan reasons less than the API, and Cuso skipped work it did on the Gateway.
  - Only models on your plan run (`chatgpt-plan:status` lists them). A Gateway id `openai/<slug>` runs as `<slug>`.

## How a run works

- **Lanes.** Repeat N runs in lane N: its own eval organization (`sokosumi-evals-N`) with an owner (Robin Keller), two teammates (Hannah Weber does research, Alex Kim writes), the Projects "Sokosumi Marketing" (an X account) and "utxo AG Outreach" (a LinkedIn account), a newsletter, a "Launch team" room, a Soko Bot and a Cuso. `eval-lanes.service.ts` makes them on first use and resets the Soko Bot's world before its first case. Agent-to-agent cases add Mira, a research Coworker whose chat answers Core scripts in process (`lib/evals/fake-coworker.ts`, host under `.invalid`), and Juno, Hannah's own Soko Bot in the Launch team room, which runs for real (`eval-a2a.ts`).
- **Order.** Soko Bot cases run in order, and later ones build on what earlier ones made: the Coworker events act on the Task the first case created. A case with `setup` starts from a clean slate.
- **Scoring.** A scenario passes when every deterministic check passes and the judge does not say "fail". A judge that cannot answer (the CLI is missing or logged out, the Gateway is down) leaves the case scored by its checks alone. CMO research and strategy cases check the Brand Brain and the plan against what the brand really sells (`cmo-brand-checks.ts`, shared with `cmo:lab`).
- **Outcomes.** Each case is regressed, fixed, flaky, failing, passing, error (could not run) or skipped (needs something the environment lacks, such as a connected mailbox), from its repeats and the last weekly runs (`lib/evals/eval-compare.ts`). Regressed means most finished repeats fail after a history of passing; one failed repeat of two is flaky, since a judge can flip. An error (the case could not run) is no verdict: it never counts as a failure, error-only weeks are skipped when picking the week a case is compared with, and suite pass rates count every case once however many repeats it ran.
- **Cost and time.** Each case is also costlier or slower when the median of its scored repeats is more than 1.3 times its median in the last five weekly runs (at least three needed). Admin → Evals, `sokosumi evals show` and the weekly email show both; the email goes out on a regression or a costlier case.
- **Weekly run.** Cases a judge grades (scenarios) run twice, the rest once, and the weekly run's judge is `WEEKLY_JUDGE_MODEL` (Sonnet 5), not the Opus judge of runs someone starts (`eval-runs.service.ts`).
- **Stuck runs.** A run still running 24 hours after it started is ended: its open cases become errors and the next run starts. The longest weekly run so far took 9.4 hours.

## What keeps mainnet safe

Eval bots run on mainnet, so nothing they do may leave their organization (`lib/evals/eval-guard.ts`):

- Global Coworkers are not offered to them and cannot be assigned or asked: they would do real, paid work.
- Hires, newsletter subscriber adds, publishing a post now, ad campaigns and comment replies answer as if they worked without running. The tool call is still recorded, so cases still check whether the bot tried. Scheduling runs for real, because a month counts a post as made once it is scheduled; the publisher never picks up a post on an eval account.
- The stand-in social accounts carry an `eval:` Composio id, and the social syncs skip them.
- Their bots are paused for unprompted work between runs, and eval turns start with `lab:`, which keeps them out of allowances and fleet statistics.

Credits: each lane's organization is topped up to 2,000 free credits before a run.

## Adding a case

- **Soko Bot:** add a scenario to `SOKO_BOT_SCENARIOS` in `packages/soko-bot/src/scenarios.ts` (prompt or trigger, `expect` checks, a rubric for the judge) and its area in `SOKO_BOT_AREAS` (`eval-cases.ts`). Write it against the lane's world above, and put it where the state it needs exists.
- **Stand-up:** `eval-standup.ts` runs the organization's daily stand-up in the lane with the real host model on a world it sets up (Robin's bot and Juno joined, Mira on a running Task and one waiting for Robin, an open need), and checks the thread, the mention, the hand-off and the cost.
- **Agent to agent:** give the scenario an `exchange` (who answers and how: Mira's scripted replies, Hannah's messages, or Juno). The case follows every follow-up the bot's waits start until the chain ends, ends a wait that can only run out, and checks and judges the whole chain; the answer checked is the last turn's.
- **CMO chat:** add to `CMO_SCENARIOS`; it runs on the lane's Cuso, after the CMO research and strategy cases. A `follow_up` trigger starts the case as the follow-up of the chat turn an earlier case asked (`ask` is that case's prompt), the way the watch sync starts one, so put it right after that case.
- **CMO research or strategy:** add the brand to `fixtures/cmo-brands.json` and to `RESEARCH_BRANDS` or `STRATEGY_BRANDS` in `eval-cmo-cases.ts`. A strategy case needs the brand's Brand Brain in `fixtures/cmo-brand-brains.json`: run its research case once and copy the saved Brand Brain in.

## Owner benchmark

The north-star cases: real, multi-step owner requests that must work end to end ("create a daily schedule where CodePat writes an architecture note, make 2-3 minimal images, draft it on my Padierfind X, tell me so I can approve"; "I want to launch something new"; "I made a YouTube video, use it"). They live in `apps/core/src/services/evals/ownerbench/` as journeys (`journeys.ts`), area "Owner bench", one case each.

- **Steps.** A journey is a few steps: the owner's messages, a Coworker answering on the Task the bot gave it (`coworker`), or the bot's own schedule firing (`schedule_fires`, started as the cron starts it). A step ends when its turns, follow-ups and waits have settled. Core answers for CodePat and Mira; a chat question to them gets no reply, and that wait ends after 90 seconds of quiet.
- **Checks.** After each step: the tools and answer (as scenario `expect`), then the world it left (`outcomes`: the schedule's days, time and brief, the Coworker's Task brief, image prompts, drafts on the right Project and network, nothing sent). The judge grades the whole chain against what a strong human assistant or Claude Code would have done.
- **Progress, not just pass/fail.** Each result's output has `score` (steps passed, steps right in a row from the start, checks passed) and `totals` (turns, tool calls, tool errors, retries after a failed call, time, cost), and each step's own record.
- **World.** `journey-world.ts` adds CodePat (coding Coworker), the owner's Padierfind Project with an X account, and the PDFs or posts a journey needs, on top of the lane's world.
- **Running.** They are left out of suite runs and the weekly run (each is many turns). Run them by name or all at once:

```bash
pnpm evals:local --plan --ownerbench                       # all journeys
pnpm evals:local --plan --ownerbench --suite cmo --cuso-version cmo-v26
pnpm evals:local --plan --cases owner-codepat-daily-post
```

A new Soko Bot or Cuso default must pass the owner benchmark at least as well as the current default, with cost per turn no worse, on **both** the dev journeys and the held-out set below: one baseline run and one candidate run, each with `--holdout`, and `scripts/ownerbench-compare.mts` reporting the bar met on each set.

**A new version against the baseline.** Run the benchmark twice from the same checkout, once on the baseline versions and once on the candidate, then compare. Each journey's `totals` carry its tokens (`inputTokens`, `cachedInputTokens`, `outputTokens`, `inputTokensPerTurn`, background runs included), which is the cost proxy on the plan, where no price is reported.

```bash
pnpm evals:local --plan --ownerbench --holdout HELD_OUT.json --soko-bot-version v36 --cuso-version cmo-v23 --json-out baseline.json
pnpm evals:local --plan --ownerbench --holdout HELD_OUT.json --soko-bot-version v39 --cuso-version cmo-v26 --json-out candidate.json
pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-compare.mts baseline.json candidate.json --holdout HELD_OUT.json
```

**Per-item judge (`--judge per-item`).** Optional 3-vote per-criterion judge (B1 / R1-A) that replaces holistic `pass`/`weak`/`fail` grading with frozen atomic yes/no splits (every item majority must pass). Dev splits live in `apps/core/src/services/evals/ownerbench/dev-rubric-splits.json`; held-out splits stay outside the repo beside the held-out journeys file and are passed via `--splits FILE` (`OWNERBENCH_SPLITS_FILE`, JSON object or module exporting `HELDOUT_RUBRIC_SPLITS`). Review every new or updated split against [`docs/evals/benchmark/rubric-split-checklist.md`](../evals/benchmark/rubric-split-checklist.md). To re-score finished runs without re-running bots or modifying Postgres (keeping both old and new views):

```bash
pnpm evals:local --rejudge BASELINE_RUN_ID --judge per-item --holdout HELD_OUT.ts --splits HELD_OUT_SPLITS.json --json-out baseline-b1.json
pnpm evals:local --rejudge CANDIDATE_RUN_ID --judge per-item --holdout HELD_OUT.ts --splits HELD_OUT_SPLITS.json --json-out candidate-b1.json
pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-compare.mts baseline-b1.json candidate-b1.json --holdout HELD_OUT.ts
```

Holistic and per-item scores are not comparable (`ownerbench-compare.mts` rejects mixed judge modes); always compare runs scored under the same judge.

**Held-out journeys.** A second set nobody iterates on, written from real prod requests and kept out of this repository so builders never tune to it. Whoever owns the benchmark keeps the file outside every checkout and hands its path only to whoever runs a version comparison; builders don't read it. Its results are reported as totals and a verdict only (journeys passed, steps right, tokens per turn, how many regressed), never per journey or by id, and don't enter the dev scoreboard. It's a JSON array of journeys in the same shape as `journeys.ts`, or a TypeScript module exporting them as `HELDOUT_JOURNEYS`, with ids starting `owner-holdout-`, using only the benchmark's world, `prepare` kinds, step kinds and outcome kinds (`ownerbench/holdout.ts` checks every journey and names each problem). What a prepare seeds comes from the journey's own `fixtures`, so the repository holds the mechanism and never the set's content. Each held-out journey runs three times in a run (`HOLDOUT_REPEATS`): it counts as passed only when all three did (pass^3), and its pass^1 share and mean steps count too. Run it with `--holdout FILE` beside `--ownerbench`, in both the baseline and the candidate run. Its per-journey results stay in the database of whoever ran it (area "Owner bench (held out)"); only `ownerbench-compare`'s totals and verdict are shared. Fix mechanisms, never a journey's wording: no prompt text, rule or check may name a benchmark case, account, Coworker or phrasing.

It prints each journey side by side, marks every journey that passed on the baseline and fails on the candidate, and says whether the bar holds, on the dev set and on the held-out set separately: at least as many journeys passed, a pass^1 share and steps right no lower, every repeat scored (no ERROR) and as many on both sides, at least three per held-out journey, no such regression, and input tokens per turn no higher. It must hold on both; a dev gain with a held-out drop is overfitting, and without held-out journeys in both runs the bar is not met.

**Runtime parity.** `evals:local` always runs the in-process runtime: its own loop, no sandbox tools (shell, files, helper agents) and no final report call when time runs out. Deployments run the sandbox runtime. Each journey's output records where it ran (`runtime.adapter`, and `runtime.models`: `chatgpt-plan` or `gateway`). Before a local delta decides anything, run the same journeys once on a deployment and compare:

```bash
pnpm evals:local --plan --ownerbench --json-out local.json
# The old Preprod is frozen: point both commands at a PR preview (`/deploy mainnet`) with --api-url instead of --preprod.
sokosumi --preprod evals run --cases owner-codepat-daily-post,owner-cuso-launch --wait
sokosumi --preprod evals show RUN_ID --json > deployed.json
pnpm --filter @sokosumi/core exec tsx scripts/ownerbench-parity.mts local.json deployed.json
```

The comparison flags each journey that passes on one runtime only or gets a different number of steps right. Trust a version's delta only on journeys that agree; a flagged journey is measuring the runtime. `evals:local --report RUN_ID --json-out FILE` writes the report of a run already finished.

## Cuso versions

Cuso changes ship on a version, as Soko Bot's do. To release one, add `cmo-vN` to `SOKO_BOT_PRODUCT_VERSIONS` and run the CMO suite with `--cuso-version cmo-vN`. When nothing regresses, point `CMO_SOKO_BOT_VERSION_ID` at it so new hires get it. Lookups accept every Cuso version (`CMO_SOKO_BOT_VERSION_IDS`). Existing Cusos stay on their version until an administrator moves them: `POST /v1/admin/soko-bots/versions/migrate` with `fromVersionId` and `toVersionId` both Cuso versions (always give `fromVersionId`: without it every bot moves). The admin page only offers personal versions as targets.
