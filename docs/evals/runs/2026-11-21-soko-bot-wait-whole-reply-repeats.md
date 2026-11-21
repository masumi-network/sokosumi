# Eval run: soko-bot-wait-whole-reply-repeats

- Date: 2026-11-21
- Run: `01a1fd42-7d1e-778d-8244-db31fdeb2152` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 3
- Cost: $0.11

## Results

**Evals** (local, no commit, 3 repeats)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 4/6    | 0         | 0     | 2     | 0       |

Cost $0.11 · run `01a1fd42-7d1e-778d-8244-db31fdeb2152`

## Before and after

Baseline: v33 on main had `a2a-several-messages` 0/3 and `a2a-no-answer` 1/3 (`2026-11-21-soko-bot-a2a-baseline-v33.md`). Here: 2/3 and 2/3.

## Failed cases

### `a2a-no-answer`: Nobody answers

- Failed check: Answer matches /(not|no|hasn.t|didn.t|did not|has not|haven.t|without|still)[^.]{0,40}(answer|repl|respon|heard|back|pending)/: DONE: Mira’s reply in Ask Mira is empty, so I can’t confirm whether she can take
- Judge: weak, The question Soko sent Mira was clear: it asked about German-language market research next week and what scope, materials and availability she would need. After the wait ran out, Soko checked the Ask Mira room and saw her only message was empty. It told Robin plainly that it couldn't confirm her answer and didn't invent one. However, the scenario requires one concrete next step, such as asking again later, putting the request in a Task for her, or asking someone else. Soko offered none and left the chain dead with Robin. This is the second time Mira hasn't answered this exact question, which made offering a next step even more important. The answer also has no link to the room, even though the instructions asked for links.
- Judge: weak, In the first turn the bot sent Mira a clear question and set up a wait correctly. In the follow-up it told Robin plainly that Mira didn't answer. It made up no reply and said nothing about her availability, so the answer is honest. But the rubric requires one concrete next step (ask again later, put it in a Task for her, or ask someone else), and the bot offered none. It also didn't schedule a retry, so the chain stalls and Robin has to decide what happens next.
- Judge: weak, The question to Mira was clear, and the first turn set up a proper wait. When the wait ran out, the final answer correctly said Mira hadn't replied and didn't make up an answer or describe her availability. It falls short in two ways. First, it offers no concrete next step: it doesn't suggest asking again, turning the question into a Task for her, or asking someone else, and it took none of those steps itself. Second, "I'm still waiting" suggests the bot is still watching for her reply, but no new wait or schedule was set up, so nothing will happen unless Robin follows up.

### `a2a-several-messages`: A teammate answers in two messages

- Failed check: Answer matches /friday/: Queued chat message.

The task currently shows Thursday, November 26 as the due

- Failed check: Reported after the other side answered: the last answer came before theirs
- Judge: fail, The bot posted the question in the Launch team room, then ended the turn straight away. It didn't wait for Hannah, schedule a check-in, or say it would follow up. Hannah answered in two messages: two of the five pricing pages are done, and the other three need until Friday at noon, so the Task's Thursday date will slip. Neither message reached the owner. The last thing the owner read was the Task's Thursday Nov 26 date plus "no reply yet", which misses the scenario's intent. The claims it did make were accurate: the message was queued, and the dueOn date came from the tool result. So honesty is fine, but the outcome fails.

## Why the failures happened

- `a2a-several-messages` repeat 1: the bot never called `wait_for`, so nothing woke it; both repeats that waited relayed Hannah's two messages, Friday included.
- `a2a-no-answer` repeat 3: told that Mira did not answer, the bot still called her failed reply "empty"; the owner is told plainly, the wording check misses it.

## Verdict

Ship, with the main run of this PR.

## Links

PR: fix(soko-bot): wake a chat follow-up once the other side has finished.
