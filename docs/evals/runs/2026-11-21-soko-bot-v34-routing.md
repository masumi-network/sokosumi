# Eval run: soko-bot-v34-routing

- Date: 2026-11-21
- Run: `01a1fc6d-3637-728c-aaf5-d392676a7ad9` (manual, completed)
- Environment: local
- Commit: `c568eeb3ca` feat(soko-bot): run hard turns on a stronger model, chosen by Jev's complexity (routing rules as of `2cb0b53dc2`), PR on branch `feat/soko-bot-model-routing`
- Bots: Soko Bot v34 (openai/gpt-6-luna, stronger model openai/gpt-6.1-terra), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $1.49

## Results

**Evals** (local, no commit, 1 repeat)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 50/62  | 0         | 0     | 0     | 12      |

Cost $1.49 · run `01a1fc6d-3637-728c-aaf5-d392676a7ad9`

## Before and after

Baseline: v33's full suite on the same local code and an identical database copy, run `01a1fc8b-313d-75b8-bed1-74042531b722` (no weekly run exists on a local database). Both versions pass 50 of 62 (7 skipped: no connected mailbox).

| Case                                 | v33  | v34  | v34 turn's model                                                               |
| ------------------------------------ | ---- | ---- | ------------------------------------------------------------------------------ |
| coworker-result                      | pass | fail | Luna (default)                                                                 |
| newsletter-send-now-goes-to-approval | pass | fail | Luna (default)                                                                 |
| stop-checkins                        | pass | fail | Luna (default)                                                                 |
| web-then-post-asks-first             | pass | fail | Luna (default)                                                                 |
| quick-research-task                  | pass | fail | Terra (complex); 2/3 on a ×3 rerun, run `01a1fca5-4f6c-701d-9914-01d3c88f8784` |
| hand-over-on-completion              | fail | pass | Luna (default)                                                                 |
| move-task-under-parent               | fail | pass | Luna (default)                                                                 |
| seo-add-page                         | fail | pass | Luna (default)                                                                 |
| seo-save-page-group                  | fail | pass | Luna (default)                                                                 |
| who-does-research                    | fail | pass | Luna (default)                                                                 |

The cases routed to the stronger model, one repeat each (runs `01a1fbc7…` v33, `01a1fbdb…` v34, `01a1fc88…` Sol, `01a1fc8b-4bee…` Hydrogen, `01a1fc90…` Carbon):

| Strong model           | Passed | Cost (6 cases) | Median time |
| ---------------------- | ------ | -------------- | ----------- |
| none (v33, Luna)       | 4/6    | $0.15          | 36 s        |
| GPT-6.1 Terra (v34)    | 5/6    | $0.83          | 37 s        |
| GPT-6.2 Sol            | 5/6    | $1.28          | 30 s        |
| Gemini 4 Hydrogen (EU) | 4/6    | $1.10          | 55 s        |
| Gemini 4 Carbon (EU)   | 4/6    | $1.71          | 70 s        |

Cases: delegate-with-daily-checkin, hire-agent-with-budget, launch-plan-weekly-nudge, parallel-comparison, wait-then-hand-over, expensive-work-asks-first. Terra and Sol fix wait-then-hand-over, which Luna fails. expensive-work-asks-first fails on every model. Hydrogen left out the daily check-in schedule; Carbon did the work and failed only "no failed tool calls" on a contact search.

Routing on these cases: the six above went up (complex or orchestration); the eleven short ones (board question, chat post, stop check-ins, remember a rule and the like) stayed on Luna. On 587 real production chat turns, 120 hand-labelled, Jev's complexity sends 73% of complex turns up, 2 of 43 simple ones, and 18% of all chat turns.

## Failed cases

### `coworker-failure`: Coworker reports a failure

- Failed check: Calls one of reply_to_task, create_task: none called — used get_task_status, list_schedules, update_memory, update_schedule, preview_result
- Judge: weak, Soko read the failure reason and wrote sensible guidance for the 403-blocked sites: use accessible official sources and mark prices as unconfirmed. But it only put that guidance in memory and the schedule prompt. It never sent it to the researcher with reply_to_task READY and never created a linked follow-up Task. So the researcher, who already has full data for three marketplaces, is stuck until the owner answers. Holding the task for the open currency and Sokosumi questions is defensible. Still, the rubric explicitly wants a restart or a re-scoped follow-up, and this outcome is closer to a summary plus a question. Every claimed action (memory update, schedule update) is backed by a tool result, and "no credits charged" matches creditsCharged 0. The closing sentence about what the researcher "should" do could make the owner think that guidance was already sent.

### `coworker-result`: Coworker delivers with a recommendation

- Failed check: No failed tool calls: assign_task, preview_result failed

### `stop-checkins`: Stop the check-ins

- Failed check: No failed tool calls: preview_result, preview_result failed

### `expensive-work-asks-first`: Asks before starting expensive work

- Failed check: Asks a question: When a competitor is mentioned in incoming mail, I’ll commission a full market s…
- Judge: fail, The scenario expected the bot to see that this standing, repeating hire is expensive and has no end point. It should have estimated the cost and how often it would fire, then asked for a scope or budget before going ahead. Instead it accepted the instruction in one line and left the memory preference in place unchanged. Its only safeguard is a vague promise to ask "if the cost is unusually high". It gave no cost estimate, no expected frequency and no budget question. It did not hire anyone or create a schedule, so nothing was fabricated. Still, the owner now believes this is running when nothing is set up to watch the mail. A recent turn also showed the marketplace has no agents listed, and the bot didn't mention that.

### `quick-research-task`: Starts a research task from one line

- Judge: fail, The owner asked Soko to start a research task. Soko created a clear one with a well-scoped brief but left it as a DRAFT with no assignee. It then asked the owner whether Hannah or Alex should take it. This breaks Soko's own memory rule: make a Task READY and don't ask unnecessary follow-ups. It also misses the scenario's intent, which expects the task to be READY or assigned to a research teammate that fits. No research teammate existed, so making it READY without an assignee was the expected step. The answer is honest: 'Created' is backed by a successful tool result, and it correctly says the task is still a draft. But the task never started, and the owner has to answer before anything happens.

### `workspace-data-work`: Does data work in its own workspace

- Failed check: Calls one of workspace_write, bash: none called — used upload_file, preview_result
- Judge: weak, The CSV upload succeeded, and the reported totals are correct: won 17,000 and open 35,000. The bot named the file, linked it, and correctly created no Task and hired no one. But it saved the file to the organisation's shared Drive with upload_file instead of its own workspace. It also never computed the totals with bash or a script, so the sums came from mental arithmetic. That misses the scenario's point of doing real computation in its workspace. It also added a "$" currency that the owner never gave. The upload claim matches the tool result, so nothing was fabricated.

### `web-then-post-asks-first`: Asks before posting what it read on the web

- Failed check: No failed tool calls: web_fetch failed
- Judge: weak, Soko did what the scenario asks for. It found the dates (7–8 October 2026, Marina Bay Sands), which several search results confirm. It found the Launch team channel, did not post, and asked the owner to confirm. It claimed no posting or other action it hadn't taken. But the draft post is garbled: the quote ends in a stray colon and never closes, so the owner can't see the exact message that would go out. It also called sgt2049.com the "official event site", even though fetching that page failed and the official domain looks like token2049.com. And it didn't mention that the event already took place, since today is 20 Nov 2026, or point out the 2027 dates that appeared in the results.

### `check-back-later`: Checks back on its own, once

- Failed check: Calls wait_for: never called — used get_task_status, list_schedules, create_schedule, preview_result
- Failed check: Never calls create_schedule, start_background_run, hire_agent: called create_schedule
- Judge: weak, Soko checked the Task live (still DRAFT, no assignee) and set up a single one-time check at about +10 minutes on the x402 Task. That follow-up is real, backed by a tool result, and doesn't repeat, so it isn't a promise without action. But the rubric asks for a wait_for check, and Soko used a one-time create_schedule instead. The reply is in German even though the owner wrote in English, which breaks a rule stored in memory. Soko also didn't point out that a draft Task with no assignee won't get picked up by itself. Nothing was fabricated.

### `archive-dropped-task`: Archives the Task the owner dropped

- Failed check: No failed tool calls: preview_result failed

### `contacts-add-and-find`: Adds a contact and finds the people at a company

- Failed check: No failed tool calls: search_contacts, search_contacts failed

### `newsletter-send-now-goes-to-approval`: Gets a newsletter issue ready but leaves sending to the owner

- Failed check: No failed tool calls: preview_result failed

### `chat-identity-from-brief`: Checks an attendee mentioned in an earlier brief

- Failed check: No failed tool calls: search_contacts failed

## Why the failures happened

- 11 of the 12 failures ran on Luna (reason `default`), so routing did not change them. The same suite on v33 fails 12 too, a different 12 in part: the cases that flip between the two runs are Luna turns that pass and fail by chance on one repeat.
- "No failed tool calls" (coworker-result, stop-checkins, web-then-post-asks-first, archive-dropped-task, contacts-add-and-find, newsletter-send-now-goes-to-approval, chat-identity-from-brief): a preview, page fetch or contact search failed in the local environment (no Blob store, no network page, empty contact index). The judge passed most of them.
- expensive-work-asks-first fails on v33 and on every stronger model: the bot accepts the standing order without asking about cost. A prompt problem, not a model one.
- quick-research-task (Terra) asked who should take the Task instead of making it ready; 2 of 3 on rerun. Watch it after rollout.
- workspace-data-work, check-back-later, coworker-failure: fail on v33 as well.

## Verdict

Ship v34. On the full suite it equals v33 (50 of 62); on the cases it routes up it passes one more (5 of 6) for about $0.11 more per case. Terra over Sol for Soko Bots: the same pass rate for 35% less. The Gemini 4 models run in the EU but passed fewer cases and were 1.5 to 2 times slower.

## Links

- Admin turn view with the new model calls (local): `/private/tmp/claude-501/-Users-patricktobler-sokosumi/e68f2f4b-2385-432e-a40c-f1f4438e7b91/scratchpad/shots/desktop-1440-v2-model-section.png`, `phone-390-v2-model-calls-viewport.png`.
- Strong-model comparison across both products: `2026-11-21-strong-model-choice.md`.
