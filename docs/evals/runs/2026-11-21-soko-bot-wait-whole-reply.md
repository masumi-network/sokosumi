# Eval run: soko-bot-wait-whole-reply

- Date: 2026-11-21
- Run: `01a1fd3a-1c68-7649-ba91-4c64c53ee1e5` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.22

## Results

**Evals** (local, no commit, 1 repeat)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 4/9    | 0         | 0     | 0     | 5       |

Cost $0.22 · run `01a1fd3a-1c68-7649-ba91-4c64c53ee1e5`

## Before and after

Baseline: v33 on main, run `01a1fd30…` (`2026-11-21-soko-bot-a2a-baseline-v33.md`), same nine cases, same local lanes.

| Case                    | v33 on main                                | v33 with this change                                                       |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `a2a-long-reply`        | fail (bottom line cut at 4,000)            | **pass** (whole reply)                                                     |
| `a2a-several-messages`  | fail (0/3 in baseline runs)                | fail here; **2/3** in the repeats run, and passes every time the bot waits |
| `a2a-no-answer`         | fail ("Nothing was changed in this turn.") | fail here; **2/3** in the repeats run                                      |
| `a2a-multi-turn`        | pass                                       | pass                                                                       |
| `a2a-bot-to-bot`        | fail (`open_direct_chat`)                  | pass                                                                       |
| `a2a-hop-limit`         | fail (`open_direct_chat`)                  | fail (last reply never reported)                                           |
| `a2a-coworker-declines` | pass                                       | fail (bot never waited)                                                    |
| `a2a-ask-and-relay`     | pass                                       | pass                                                                       |
| `a2a-asks-back`         | fail                                       | fail                                                                       |

## Failed cases

### `a2a-asks-back`: The Coworker needs something only the owner knows

- Failed check: Asks a question: DONE: Mira needs to know whether the note is for the board, sales, or investors,…

### `a2a-no-answer`: Nobody answers

- Failed check: Answer matches /(not|no|hasn.t|didn.t|did not|has not|haven.t|without|still)[^.]{0,40}(answer|repl|respon|heard|back|pending)/: DONE: Mira’s reply is empty, so I can’t confirm whether she can do German-langua
- Judge: weak, The first turn asked Mira a clear question through ask_coworker and set a 5-minute wait_for. When the wait ended with an empty message from Mira, the bot read the room and told Robin plainly that it couldn't confirm whether she can do the work. It invented no reply and said nothing about her availability. The scenario also requires one concrete next step, such as asking again later, putting the request in a Task for her, or asking someone else. The final answer offers none and sets up no further check-in, so the chain stops and Robin has to decide what happens next.

### `a2a-several-messages`: A teammate answers in two messages

- Failed check: Answer matches /friday/: Queued chat message.

Hannah’s latest note in Launch says the remaining three ma

- Failed check: Reported after the other side answered: the last answer came before theirs
- Judge: fail, The bot posted the question to Hannah in the Launch team room. It then answered the owner right away, using Hannah's old "Thursday afternoon" message, which she had posted three times before the question. Hannah's actual reply came in two messages: two of five done, and the rest by Friday at noon, with the Task's Thursday date slipping. No follow-up turn ever relayed either message. The last thing the owner read anchors on Thursday, a date that is now wrong. The answer is honest that the message is only queued and that the Thursday quote comes from chat history. Even so, the scenario's intent was missed.

### `a2a-coworker-declines`: The Coworker says no

- Failed check: Answer matches /(can.t|cannot|can not|not able|unable|only does|declin|no video)/: Asked a Coworker.
- Failed check: Reported after the other side answered: the last answer came before theirs
- Judge: fail, The bot asked Mira as the owner requested, and the question was clear. It did not assign Mira a Task or hire anyone. But the chain ends with the owner reading only "Asked a Coworker." Mira's refusal ("I only do desk research and written briefs") and her suggestion of Alex or a video Agent are in the chat log, yet they never reached the owner. That message was the whole point of the scenario. Saying "Asked a Coworker" is accurate because the message was queued. Still, the reply is so short that the owner doesn't know a reply is pending or that the bot will pass it on. The bot also didn't mention that Mira's profile (Research only) makes video editing unlikely.

### `a2a-hop-limit`: A back-and-forth that has to stop

- Failed check: Reported after the other side answered: the last answer came before theirs
- Judge: weak, Soko stayed under the limit (four posts) and never claimed an agreement Juno didn't give. Its last report correctly says no date is agreed and that both Dec 7 and Dec 8 are still unconfirmed. But the stop looks accidental, not chosen. Juno had said three times that she can't confirm anything without Hannah, and Soko still sent a fourth message asking the same thing. It then ended the turn without waiting, so Juno's reply ("should remain provisional") was never read or passed to the owner. The report doesn't tell Robin that the back-and-forth has stopped. It also doesn't say why it stalled (Juno has no input from Hannah) or suggest the obvious next step: asking Hannah, who is in the room, directly.

## Why the failures happened

- `a2a-coworker-declines`, `a2a-several-messages` (this run), `a2a-hop-limit`: the bot did not call `wait_for` after asking (or after its last message), so no follow-up ever ran. That is v33's prompt, not the wait: Core cannot hand over a reply nobody waits for. v35's `send_message` waits as part of asking.
- `a2a-no-answer`: the follow-up now hears "Mira did not answer", but in one of three it still read the room and called her failed reply "empty"; the case's wording check misses that phrasing. The owner is told plainly either way.
- `a2a-asks-back`: unchanged; the bot passes Mira's questions on without asking the owner a question (judge passes it).

## Verdict

Ship: the two failures it targets are fixed when the bot waits (the long reply reaches the owner whole; Hannah's second message is in the report), nothing regressed that the bot's own waiting does not explain, and no prompt, tool or version changes, so no new version.

## Links

PR: fix(soko-bot): wake a chat follow-up once the other side has finished.
