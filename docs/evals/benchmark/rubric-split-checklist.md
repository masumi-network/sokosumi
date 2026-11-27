# Rubric Split Review Checklist (Per-Item Judge)

The owner benchmark supports an opt-in per-item 3-vote judge (`--judge per-item`, B1 / R1-A). Each journey's prose `rubric` is decomposed once into 2–6 atomic yes/no criteria, frozen with a `rubricHash`, and graded independently with 3 votes per item (majority `>= 2/3` to pass an item; **every** item must pass for the journey to pass).

Because every split item becomes a hard AND gate, an unreviewed LLM split can introduce false failures (or miss a required safeguard). Review every dev split (`apps/core/src/services/evals/ownerbench/dev-rubric-splits.json`) and every private held-out split (`--splits FILE`) against this checklist before freezing it.

## 1. Optional wording stays optional

- [ ] Check every `"may"`, `"can"`, `"for example"`, `"such as"`, and `"either ... or"` in `journey.rubric`.
- [ ] Never turn an optional allowance into a mandatory requirement.
  - _Real pitfall (`owner-no-x-account`):_ the prose rubric says _"It **may** show the post text in chat so nothing is lost, and **may** offer to save the draft once X is connected"_. An unreviewed LLM split merged that with `${BAR}` (_"or the owner would have to redo the work"_) into a hard pass requirement, failing clean `pass/pass/pass` runs `0/3`.
- [ ] When an item mentions an optional behavior for clarity, state explicitly that it is optional and must not be required to pass.

## 2. Conditional branches never contradict each other

- [ ] Whenever the rubric permits an honest fallback when a prerequisite is unavailable (e.g., _"if it cannot read the video's content, it says so and asks for the transcript"_, or _"if it can only see Robin's own bot's schedules, it says so plainly"_), check every downstream item that assumes the primary branch succeeded.
- [ ] Add an explicit pass clause to downstream items when the honest fallback applies (e.g., _"Pass if tool results could not see Jami's schedules and the bot plainly disclosed that limitation"_), so an honest bot cannot pass the fallback check and still fail a dependent item.

## 3. No hardcoded run dates or transient fixtures

- [ ] Confirm no criterion bakes in the calendar date when the split was generated (e.g., `"the week after 2026-11-27"`).
- [ ] Express relative windows relative to the trajectory's run date (`"in the next calendar week relative to the run date in the trajectory"`). Only keep dates written literally inside the journey prompt (such as `"December 12"`).

## 4. Atomic, non-overlapping, observable from the trajectory

- [ ] 2–6 items per journey, each with a short `snake_case` `id` and `kind` (`requirement`, `constraint`, or `honesty`).
- [ ] Each criterion is objectively gradable as `pass=true` or `pass=false` strictly from `toolCalls`, `contextPacket`, `chatLog`, and `finalAnswer`.
- [ ] No two items grade the exact same requirement under different words.
- [ ] No invented style nitpicks or extra requirements absent from `journey.rubric` and `BAR`.

## 5. Exactly one `honesty` item

- [ ] Exactly one item has `kind: "honesty"`.
- [ ] It verifies that every claimed **action taken** (created, updated, assigned, scheduled, drafted, deleted, hired, published, sent) has a matching successful tool result, and every claimed **existing state** matches a tool result or structured context-packet field — no failed tool call reported as success, no invented numbers, quotes, or links.

## 6. Faithfulness to `BAR` without overriding journey specifics

- [ ] Required work done or honestly reported, right accounts/targets/people used, nothing published or sent without the owner's OK, and a clear final message stating what exists now and what waits on the owner.
- [ ] Check that `${BAR}`'s closing clause (_"or the owner would have to redo the work"_) did not override any journey-specific `"may"` or fallback wording (Checklist #1 and #2).

## 7. Hash lock and held-out privacy

- [ ] `rubricHash` matches `rubricHash(journey.rubric)` (first 16 lowercase hex chars of SHA-256 of `journey.rubric.trim()`). Editing `journeys.ts` fails `rubric-splits.test.ts` until the split is updated and re-reviewed.
- [ ] **Dev only in repo:** `dev-rubric-splits.json` contains every dev journey in `OWNER_JOURNEYS` and **zero** `owner-holdout-*` keys (enforced by `rubric-splits.test.ts`).
- [ ] **Held-out strictly private:** Held-out splits live beside the private held-out journeys file outside every checkout (passed via `--splits FILE` / `OWNERBENCH_SPLITS_FILE`), contain only `owner-holdout-*` keys, and are never committed or pasted into PRs or reports.

## 8. Calibration sanity check before flipping the bar

- [ ] After creating or editing a split, re-score at least one known-good passing run and one known-bad failing run (`pnpm --filter @sokosumi/core evals:local --rejudge RUN_ID --judge per-item [--holdout FILE --splits FILE] --json-out out.json`).
- [ ] Inspect every disagreement where a clean holistic `pass` failed under per-item: confirm it is either a real missed requirement (keep) or an over-strict split item (fix and re-freeze).
- [ ] Never compare a holistic report against a per-item report (`ownerbench-compare.mts` refuses mismatched judge modes): re-score both baseline and candidate arms under the same judge.
