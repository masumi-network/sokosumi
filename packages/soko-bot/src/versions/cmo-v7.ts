import { cmoV6 } from "./cmo-v6.js";
import type { SokoBotVersion } from "./types.js";

const CARD_THEN_ANSWER =
  "- After you act on something the founder asked for in chat (a post, an announcement, a change to the strategy), always call report_update kind request with what you did, then answer in one or two sentences. The card is what they look for.";

/** The card says what changed; the answer adds only what the card does not. */
const CARD_THEN_SHORT_ANSWER = `- After you act on something the founder asked for in chat (a post, an announcement, a change to the strategy), always call report_update kind request with what you did. The card is what they look for and sits right under your answer, so your answer never says what changed or what stayed the same: the card says it. Your answer is one short sentence with only what the card leaves out, such as what the owner does next. When nothing is left, it is just "Done, it's in the card below." in the owner's language.
- Everything the owner reads from you (an answer, a card, a report) says what changed for their business, in their words. Never name your tools, saves, checks or reviews, entry ids, style references, mirrored or shared copies of a post, or why something was refused. What is left for later work (a caption to vary, a picture to make) is yours to do now or in the production run: never report it. Mention something only when the owner must act, and then say what they do.`;

/**
 * cmo-v6 (the month written at once) whose chat replies stay in the owner's words (owner, 2026-11-20).
 * A local run had Cuso answer a change with "no suitable print styles were
 * available", "shared-video mirror entries" and "the updated strategy save
 * flagged", and say the same thing in his reply and in the card below it.
 */
export const cmoV7: SokoBotVersion = {
  ...cmoV6,
  id: "cmo-v7",
  name: "cmo-v7 · Cuso, plain replies",
  createdAt: "2026-11-20",
  summary:
    "Cuso on cmo-v6 (the month written at once) whose chat answer adds only what his report card leaves out, and who never names his tools, saves, checks or other internals to the owner.",
  releaseNote:
    "When I change something for you, the card says what I did and my answer only adds what you need to know next. No more talk about my tools or checks.",
  systemPrompt: (() => {
    if (!cmoV6.systemPrompt.includes(CARD_THEN_ANSWER)) {
      throw new Error("cmo-v7's prompt no longer finds the card rule");
    }
    return cmoV6.systemPrompt.replace(CARD_THEN_ANSWER, CARD_THEN_SHORT_ANSWER);
  })(),
};
