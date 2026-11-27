import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { askJev } from "./jev";

const TIMEOUT_MS = 6_000;
const MAX_COMMENT_LENGTH = 4_000;
/** Jev must be this sure before a comment is held back. */
const MIN_CHASE_PROBABILITY = 0.6;

const CHASE_QUESTION =
  "The text is a comment an assistant wants to post on a Task. Does it mainly chase the Task's people: ask for a status or progress update, a confirmation that work has started, an ETA or the next milestone, or otherwise nudge them to act, without giving them new information the Task needs? A comment that delivers a fact, a file, an answer or a decision is no, even when it ends with a question.";

/**
 * Why a Task comment in a turn nobody asked for is not posted, or null.
 *
 * Left alone, a bot turns its own "check on X" memory follow-ups into
 * progress requests on teammates' Tasks, which pings people nobody meant to
 * ping and confuses the owner. Chasing is the owner's call: the bot reads the
 * Task itself and tells them. A member asking in chat is unaffected, and a
 * failed check lets the comment through.
 */
export async function unattendedChaseRefusal(input: {
  turn: { source: string | null; chainDepth: number };
  comment: string;
  /** A shared bot answers to the team in its room, not an owner. */
  shared: boolean;
  /**
   * E13 versions: whether the Task's Coworker turned it down (it is FAILED),
   * asked only once a comment is held back.
   */
  declined?: () => Promise<boolean>;
}): Promise<string | null> {
  if (input.turn.source === "CHAT" && input.turn.chainDepth === 0) return null;
  let probability: number | undefined;
  try {
    const answers = await askJev({
      state: { comment: input.comment.slice(0, MAX_COMMENT_LENGTH) },
      questions: { chases: CHASE_QUESTION },
      timeoutMs: TIMEOUT_MS,
    });
    probability = answers.get("chases");
  } catch (error) {
    // Only safe fields: a model error can quote the text it was sent.
    recordCoreWarning(
      { operation: "soko_bot_chase_check" },
      {
        message: "Could not check whether a Soko Bot comment chases people",
        why: "Jev, the judging model, failed or timed out",
        fix: "Nothing: the comment is posted unchecked.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    return null;
  }
  if (probability === undefined || probability < MIN_CHASE_PROBABILITY)
    return null;
  const audience = input.shared ? "the team in your shared room" : "your owner";
  if (await input.declined?.())
    return `Not posted: this Task's Coworker set it FAILED, so asking them to take it up again repeats a request they turned down. Read their reason with get_task_status. If information you hold would fix it, reply with that information. If they declined or are busy, tell ${audience} what they said and offer options: another Coworker (find_coworkers), doing it yourself, or waiting until the date they gave with a check set for it (create_schedule with runAt).`;
  return `Not posted: this comment chases people for a status update, and nobody asked you to. Read the Task with get_task_status and tell ${audience} what changed instead; drop the follow-up from memory once it is answered.`;
}
