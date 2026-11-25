# Eval run: standup-bots-speak

- Date: 2026-11-25
- Run: `01a213ca-df5c-777d-a7d8-34385ad8fe07` (manual, completed)
- Environment: local
- Commit: `35d0fd2` standup3-final
- Bots: Soko Bot v34 (openai/gpt-6-luna), Cuso cmo-v20 (openai/gpt-6-luna)
- Judge: none recorded
- Repeats: 3
- Cost: $0.00 recorded (the stand-up's small-model calls are counted on the stand-up run, not the case: about $0.003 per posting case)

## Results

**Evals** (local, 35d0fd2, 3 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 12/12  | 0         | 0     | 0     | 0       |

Cost $0.00 · run `01a213ca-df5c-777d-a7d8-34385ad8fe07`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

None.

## Why the failures happened

None failed on this commit. The first local run of `standup-match` and `standup-no-match` came back QUIET: lane bots stay `proactivePaused` so no cron wakes them, and the stand-up skips paused bots. The case now passes its own `mayPost`, since a lane's pause is the harness's, not an owner's. The cases from #8061 never ran (the Gateway was over budget then), so this was not caught before.

## Verdict

Ship: the four `standup` cases pass 3 of 3. Only bots post, Robin's bot tells Mira's work for Robin and mentions him for her waiting Task, Mira posts nothing of her own, the hand-off still opens under the bot's message and Mira answers it, and the week in review is unchanged.

## Links

The PR that adds the change (stand-up: the Soko Bots speak).
