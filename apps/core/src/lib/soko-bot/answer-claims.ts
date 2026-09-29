import { askJev } from "./jev";

const TIMEOUT_MS = 4_000;
const MAX_TEXT_LENGTH = 8_000;
/** Below this the text is shown; Jev is sure about plain reports and questions. */
const MAX_CLAIM_PROBABILITY = 0.5;

const CLAIMS_ACTION =
  "The text is an assistant's reply to its owner. confirmedChanges lists the changes its tools confirmed in this turn. Does the reply say the assistant has already changed something in Sokosumi or for other people that is not in confirmedChanges: created, assigned, updated or archived a Task, sent or posted a message or email, scheduled a check-in or reminder, changed a calendar, uploaded to Drive, hired an Agent, generated an image, or changed its memory? Reporting a change that is in confirmedChanges is fine. Offers, plans, questions, research findings, calculations, files in the assistant's own private workspace, and what other people did do not count.";

/**
 * Whether the bot's own words claim an action its receipts do not show.
 * Actions are shown from verified receipts, so such a reply is not shown;
 * one that reports the confirmed changes is. Null when the check failed or
 * returned no answer: the reply cannot be shown then either.
 */
export async function claimsAction(
  text: string,
  confirmedChanges: readonly string[] = [],
): Promise<boolean | null> {
  try {
    const answers = await askJev({
      state: {
        reply: text.slice(0, MAX_TEXT_LENGTH),
        confirmedChanges: [...confirmedChanges],
      },
      questions: { claimsAction: CLAIMS_ACTION },
      timeoutMs: TIMEOUT_MS,
    });
    const probability = answers.get("claimsAction");
    return probability === undefined
      ? null
      : probability >= MAX_CLAIM_PROBABILITY;
  } catch (error) {
    console.warn("Soko Bot claim check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
