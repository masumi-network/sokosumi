import { cmoV14 } from "./cmo-v14.js";
import { CMO_CHANNEL_FIT_STRATEGY_SKILL } from "./cmo-v14-skills.js";
import {
  CMO_PLAIN_WORDS_RULE,
  CMO_PLAIN_WORDS_STRATEGY_SKILL,
} from "./cmo-v15-skills.js";
import type { SokoBotVersion } from "./types.js";

/** cmo-v7's rule this one follows: what the owner reads says what changed for them. */
const OWNER_WORDS_RULE =
  "Mention something only when the owner must act, and then say what they do.";

/**
 * The plain-words rule also covers the chat: a strategy turn once told the
 * owner "X, YouTube and TikTok alone need 560 separate posts over four weeks,
 * but 127 per week allows only 508. May I consolidate Shorts, TikToks and
 * Reels into shared calendar entries?".
 */
const CHAT_RULE = `${CMO_PLAIN_WORDS_RULE}
- Never tell the owner about entries, targets, caps, cadences, counts you are short of, timeouts or retries, and never ask them to send you the calendar or decide how you store it: that work is yours. When the month is not finished yet, say only that you are still writing it and when it will be ready.`;

/**
 * cmo-v14 who writes for an owner who is not a marketer (owner, 2026-11-22):
 * plain words in the strategy and the chat, the brand, the buyer and the
 * concrete action named, and Core's review refusing marketing jargon.
 */
export const cmoV15: SokoBotVersion = {
  ...cmoV14,
  id: "cmo-v15",
  name: "cmo-v15 · Cuso, plain words for founders",
  createdAt: "2026-11-22",
  summary:
    "Cuso on cmo-v14 who writes the strategy and his messages for a founder who is not a marketer: no marketing jargon, the brand, the buyer and the concrete action named, and nothing about his own bookkeeping.",
  releaseNote:
    "I now write your strategy and my messages in plain words: who it is for, what they do, and what happens for your business. No marketing jargon.",
  systemPrompt: (() => {
    if (!cmoV14.systemPrompt.includes(OWNER_WORDS_RULE)) {
      throw new Error("cmo-v15's prompt no longer finds the owner words rule");
    }
    return cmoV14.systemPrompt.replace(
      OWNER_WORDS_RULE,
      `${OWNER_WORDS_RULE}\n${CHAT_RULE}`,
    );
  })(),
  skills: cmoV14.skills.map((skill) =>
    skill === CMO_CHANNEL_FIT_STRATEGY_SKILL
      ? CMO_PLAIN_WORDS_STRATEGY_SKILL
      : skill,
  ),
};
