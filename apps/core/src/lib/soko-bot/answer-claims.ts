import { askJev } from "./jev";

const TIMEOUT_MS = 4_000;
const MAX_TEXT_LENGTH = 8_000;
/** Below this the text is shown; Jev is sure about plain reports and questions. */
const MAX_CLAIM_PROBABILITY = 0.5;

const CLAIMS_ACTION =
  "The text is an assistant's reply to its owner. Does it say the assistant has already changed something in Sokosumi or for other people: created, assigned, updated or archived a Task, sent or posted a message or email, scheduled a check-in or reminder, changed a calendar, uploaded to Drive, hired an Agent, generated an image, or changed its memory? Offers, plans, questions, research findings, calculations, files in the assistant's own private workspace, and what other people did do not count.";

/**
 * Whether the bot's own words claim an action. Actions are shown from verified
 * receipts, so a reply that claims one is not shown; a failed check counts as
 * a claim.
 */
export async function claimsAction(text: string): Promise<boolean> {
  try {
    const answers = await askJev({
      state: { reply: text.slice(0, MAX_TEXT_LENGTH) },
      questions: { claimsAction: CLAIMS_ACTION },
      timeoutMs: TIMEOUT_MS,
    });
    const probability = answers.get("claimsAction");
    return probability === undefined || probability >= MAX_CLAIM_PROBABILITY;
  } catch (error) {
    console.warn("Soko Bot claim check failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return true;
  }
}
