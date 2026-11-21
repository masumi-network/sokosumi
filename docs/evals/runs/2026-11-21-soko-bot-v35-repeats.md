# Eval run: soko-bot-v35-repeats

- Date: 2026-11-21
- Run: `01a1fd80-ff3d-768a-adfd-6bc72db852c5` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v35 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 3
- Cost: $0.18

## Results

**Evals** (local, no commit, 3 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 11/15  | 0         | 0     | 3     | 0       |

Cost $0.18 · run `01a1fd80-ff3d-768a-adfd-6bc72db852c5`

## Before and after

Same cases on v33, 3 repeats (`01a1fd7d…`): delegate-with-daily-checkin 3/3, coworker-question 2/3, wait-then-hand-over 3/3, hand-over-on-completion 1/3. dreaming on v33 3/3 (`01a1fd7a…`).

## Failed cases

### `coworker-question`: Coworker asks a question

- Failed check: No failed tool calls: preview_result failed
- Failed check: No failed tool calls: reply_to_task, assign_task, update_task failed

### `dreaming`: Dreams silently

- Judge: fail, The dream answered "Nothing to add." as it should, and it started no work. It correctly saved the owner's standing preference to write Hannah's Tasks in German. The memory rewrite, though, misread the timeline. At 10:07 the owner said to stop checking in on the earlier EU marketplace brief. At 10:47 the owner created the top-5 brief (01a1fd81) and asked for a check every weekday at 9:00. The new memory ties the old "I'll track it myself" instruction to the new Task and says not to create check-ins for it. That reverses the owner's newer request, and the owner would have to clean it up. The dream also saved a one-off command as a Preference. It added about eight "lessons" that the activity doesn't support: the activity shows 0 failures, and no thumbs down or corrections appear in it. The prompt says a one-off is not a lesson and nothing unsupported may be added.
- Judge: weak, The turn made one successful update_memory call, started no work and answered exactly "Nothing to add.", which is correct. Two of the new lessons are well supported by the reviewer findings: check for a similar Task before creating another, and don't assign a currency the owner didn't give. The Mira lesson only says to "offer" a next step, even though the reviewer faulted the assistant for not acting itself. The main flaw: memory v11 said the EUR and Sokosumi choices were proposed assumptions, not the owner's confirmation. This rewrite turned them into a standing Decision, while the Task is still INPUT_REQUIRED waiting on Robin for exactly that question. That invents a rule and drops an explicit caution.

### `hand-over-on-completion`: Carries out the follow-up plan when the work completes

- Failed check: No failed tool calls: create_task failed
- Judge: fail, The bot read Hannah's completed Task. The follow-up description carries the substance of the findings: all three marketplaces with their pricing and positioning. It also links the Tasks and creates no schedule. But the first create_task failed because the bot left a character out of Alex's userId ('7d5' instead of '7d5d'). A second find_coworkers call returned the correct ID, and the bot still never retried. It created an unassigned DRAFT instead and told the owner Alex isn't a workspace member, which is a wrong diagnosis. It also wrote that wrong diagnosis into memory. The planned handover to Alex didn't happen, and the owner has to fix a problem the bot caused.

## Why the failures happened

- `coworker-question` (2 of 3): a failed `preview_result`, and `reply_to_task`/`assign_task` on a Task with no assignee; v33 fails the same way.
- `hand-over-on-completion` (1 of 3): same as v33's two failures.
- `dreaming` (1 of 3): the memory rewrite misread the timeline; no messaging involved.

## Verdict

No regression tied to v35.

## Links

PR: feat(soko-bot): add v35, message anyone by name and hold a short exchange.
