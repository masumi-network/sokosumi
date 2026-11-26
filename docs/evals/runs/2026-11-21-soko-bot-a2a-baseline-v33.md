# Eval run: soko-bot-a2a-baseline-v33

- Date: 2026-11-21
- Run: `01a1fd30-b35f-7602-8f55-5daaf240394d` (manual, completed)
- Environment: local
- Commit: not recorded
- Bots: Soko Bot v33 (openai/gpt-6-luna), Cuso cmo-v8 (openai/gpt-6-luna)
- Judge: claude-code:claude-opus-5-5
- Repeats: 1
- Cost: $0.18

## Results

**Evals** (local, no commit, 1 repeat)

| Suite    | Passed | Regressed | Fixed | Flaky | Failing |
| -------- | ------ | --------- | ----- | ----- | ------- |
| soko-bot | 3/9    | 0         | 0     | 0     | 6       |

Cost $0.18 · run `01a1fd30-b35f-7602-8f55-5daaf240394d`

## Before and after

No baseline: no weekly run before this one on this environment.

## Failed cases

### `a2a-asks-back`: The Coworker needs something only the owner knows

- Failed check: Asks a question: DONE: Mira says she needs to know who the Langdock note is for—the board, sales,…

### `a2a-no-answer`: Nobody answers

- Failed check: Route ∈ MANAGE_WORK | DELEGATE_TASK | DIRECT_RESPONSE | MIXED: CLARIFY
- Failed check: Answer matches /(not|no|hasn.t|didn.t|did not|has not|haven.t|without|still)[^.]{0,40}(answer|repl|respon|heard|back|pending)/: Nothing was changed in this turn.
- Judge: fail, The first turn did its job: it asked Mira clearly in the Ask Mira room and set a 5-minute wait. When the follow-up fired, the bot read the room and found only a blank message from Mira. The answer Robin finally saw was "Nothing was changed in this turn." That answer never says Mira hasn't replied and offers no next step: no Task for Mira, no later check-in, no one else to ask. It doesn't start with DONE: as instructed, and it drops the plan's own instruction to say the reply is still pending. Nothing was made up, but the scenario's point was missed. Robin is left not knowing what happened and has to chase it himself.

### `a2a-long-reply`: A long answer reaches the owner whole

- Failed check: Answer matches /march 2027/: DONE: Mira’s comparison points to four distinct models: Langdock sells company s
- Judge: fail, Robin asked for Mira's bottom line. Her reply is about 5,900 characters, and the recommendation is in the last paragraph: Langdock and Agentur.ai matter most, and she recommends a DACH pilot in March 2027. The bot read only the first part, both in the trigger and in its single read_chat call. It summarised entries 1–4 and then said it couldn't name a winner because the reply cuts off. The rubric says that outcome fails. The bot made no attempt to get the rest: it didn't read further, didn't ask Mira to resend her conclusion, and didn't schedule a follow-up. It invented nothing, though, and it was open that the text it saw was incomplete. The original question to Mira was clear and asked for her recommendation.

### `a2a-several-messages`: A teammate answers in two messages

- Failed check: Answer matches /friday/: DONE: Hannah’s latest reply says two of the five pricing pages are done, but doe
- Failed check: Reported after the other side answered: the last answer came before theirs
- Judge: fail, The bot posted a clear question in the Launch team room and set up a wait, which was a good start. When Hannah's first message ("Two of the five pricing pages are done") came in, it read the room once and closed the loop straight away. It didn't wait for her to finish or set another watch. Her second message, "Friday at noon, the Thursday date on the Task will slip", never reached Robin. Instead the bot repeated the older "Thursday afternoon" estimate. It did say Hannah hadn't reconfirmed that estimate, but Robin still came away with the deadline that is slipping and none of what Hannah actually said about when she'd finish. The rubric says reporting only her first message fails. Nothing was fabricated: what the bot said about the chat was accurate at the moment it read it.

### `a2a-bot-to-bot`: Ask another person's Soko Bot

- Failed check: No failed tool calls: open_direct_chat failed
- Failed check: Calls one of post_chat, ask_coworker: none called — used list_chats, read_chat, find_coworkers, open_direct_chat
- Failed check: Answer matches /pricing|marketplace/: Not confirmed: queued direct message.

I couldn’t find Juno in the workspace dir

- Judge: fail, The bot was supposed to ask Juno in the Launch team room, the room they share, by mentioning her, and then wait for her answer. It found that room with list_chats, but it never posted there. Instead it tried a direct chat with "Juno", and that call failed because Juno isn't a member of the organization (she's another person's bot). The bot then gave up and asked the owner how to reach Juno, so the scenario's intent was missed. Its final answer opens with "Not confirmed: queued direct message." That's false: nothing was queued, because the only send attempt failed. The rest of the answer, that it couldn't find Juno, is accurate. To its credit, it didn't guess at Hannah's work from the Task or chat history.

### `a2a-hop-limit`: A back-and-forth that has to stop

- Failed check: No failed tool calls: open_direct_chat failed
- Failed check: Calls one of post_chat, ask_coworker: none called — used find_coworkers, list_chats, read_chat, open_direct_chat
- Judge: fail, The bot never started a conversation with Juno. It couldn't find her in the directory, read the Launch team room, and then tried a direct message that failed. It did not post in the Launch team room, which it was a member of, even though that is where Juno could be reached. It handed the problem back to the owner with no other attempt and no scheduled check-in, so the negotiation the owner asked for never began. The final answer opens with "Not confirmed: queued direct message", which suggests an action that never happened because the direct message failed. The next sentence does correct this by saying nothing was sent.

## Why the failures happened

This run is the baseline for the new cases, not a regression check: every failure is how v33 and today's Core handle talking to another agent.

- `a2a-long-reply`: the follow-up hands over each reply cut at 4,000 characters (#7827), and Mira's bottom line is in the last paragraph of about 5,900. Phase 2 hands over the whole reply.
- `a2a-several-messages`: the wait fires on Hannah's first message, 30 seconds before her second. The bot then quoted the Task's due date as if she had said it. Phase 2 waits until a person has paused.
- `a2a-no-answer`: Mira never answers, the follow-up finds a blank failed reply, and the owner reads "Nothing was changed in this turn." A second variant of the swallowed relay #7813 fixed; phase 2 tells the follow-up plainly that she did not answer.
- `a2a-bot-to-bot`, `a2a-hop-limit`: the bot tried `open_direct_chat` for Juno, another person's Soko Bot, and was refused (the failure Joseph had with a Coworker). v35's `send_message` names whoever the bot wants and Core picks the room.
- `a2a-asks-back`: the bot passed Mira's questions on but did not ask the owner a question. The judge passed it; the check is strict on purpose.

The cases vary from run to run on v33. Over this run and the full run before it (`01a1fd27…`, before the last harness fix), plus a two-case rerun (`01a1fd2e…`): ask and relay 2/2, Coworker declines 2/2, multi-turn 1/2, bot to bot 1/2, hop limit 1/2, no answer 1/3, asks back 0/2, long reply 0/2, two messages 0/3.

## Verdict

Ship the cases: they reproduce all three failures from production (the cut reply, the relay of the first message only, `open_direct_chat` tried for another agent) and give phase 2 and v35 a baseline to beat.

## Links

PR: test(evals): agent-to-agent cases with a scripted Coworker and a second Soko Bot.
