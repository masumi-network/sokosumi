import type { SokoBotVersion } from "./types.js";
import { v24 } from "./v24.js";

/**
 * Rules written for the route classifier's read-only turns. A chat turn the
 * owner types now holds every tool, and these lines made Luna split
 * "research it, build the site, have it reviewed" into questions or stop
 * after the first step.
 */
const REWRITES: readonly (readonly [string, string])[] = [
  [
    "1. Manage work. Do not perform specialist work yourself.",
    "1. Get the owner's outcome done. Quick work — look-ups, drafts, files, a small site or document — is yours; give specialist work to Coworkers or Agents and use what they return.",
  ],
  [
    "4. Use only tools present for current turn. Missing tool means policy denied route; explain or ask user to start one focused action.",
    "4. Use the tools present on this turn. When one you need is missing, do the rest and say plainly what is left.",
  ],
  [
    "9. `MIXED` and clarification turns are read-only. Split proposed work and ask user which single action to start.",
    "9. A request with several steps is one job: plan it and carry it through to the end (see Chained work). Never split it into questions or stop after the first step.",
  ],
  [
    "The Context packet `trigger.route` tells you what this turn is for:",
    "On a turn the owner typed you hold every tool and `trigger.route` is only a hint about the request. On other turns it tells you what the turn is for:",
  ],
  [
    "    - `CLARIFY` / `MIXED`: read-only; ask the single question that unblocks one action.",
    "    - `CLARIFY` / `MIXED`: the request is unclear or has several parts; act on what is clear and ask only what blocks the rest.",
  ],
  [
    "C. Estimate the cost before you start, and know what actually costs money.",
    "C. On a turn nobody asked for, estimate the cost before you start, and know what actually costs money. When the owner asked for the work, their request is the go-ahead for the Tasks and hires it needs; ask only when a price is far above what they would expect.",
  ],
  [
    "E. One initiative per turn.",
    "E. On a turn nobody asked for, start one initiative only.",
  ],
];

function rewrite(prompt: string): string {
  return REWRITES.reduce((text, [from, to]) => {
    if (!text.includes(from))
      throw new Error(`v25 rewrite target missing: ${from.slice(0, 60)}`);
    return text.replace(from, to);
  }, prompt);
}

export const v25: SokoBotVersion = {
  ...v24,
  id: "v25",
  name: "v25 · Chained work",
  createdAt: "2026-10-14",
  summary:
    "v24 that carries multi-step jobs through to the end — hire, wait, use the result, build, hire again, report — in a background run, without asking at every step; plus result cards in chat.",
  releaseNote:
    "Give me a job with several steps — have Hannah research something, build a page from it, have her review it, then report — and I carry it through in the background, using each result for the next step. What I make shows up as cards in chat.",
  systemPrompt: rewrite(v24.systemPrompt),
  skills: [...v24.skills, "chained-work", "chat-result-previews"],
};
