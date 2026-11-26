import { CONTEXT_ON_DEMAND_SKILL } from "./context-on-demand-skills.js";
import type { SokoBotVersion } from "./types.js";
import { v36 } from "./v36.js";

/**
 * v36 with a small context packet (owner, 2026-11-25; ADR 0086): what waits
 * on the owner, the latest exchange once, and a map of everything else with
 * reads for it. The packet moves to the first user message with a version
 * that loads skills on demand (v39).
 */
export const v38: SokoBotVersion = {
  ...v36,
  id: "v38",
  name: "v38 · A short context and reads for the rest",
  createdAt: "2026-11-25",
  summary:
    "v36 whose every turn starts from a short packet: who asks, what waits on the owner, memory, the latest exchange and a map of every source with its size. Core adds what the turn's kind needs, and the bot reads the rest (Tasks, Projects, older messages, Jobs, mail, contacts) before it answers about them.",
  releaseNote:
    "I now look up the exact Task, mail or contact you ask about, even an old one, instead of working from a list that left it out.",
  skills: [...v36.skills, CONTEXT_ON_DEMAND_SKILL],
};
