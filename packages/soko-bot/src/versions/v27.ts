import type { SokoBotVersion } from "./types.js";
import { v26 } from "./v26.js";

export const v27: SokoBotVersion = {
  ...v26,
  id: "v27",
  name: "v27 · Coworker questions and Agent Jobs",
  createdAt: "2026-10-21",
  summary:
    "v26 that asks a Coworker in a group chat before committing work it is unsure they can do, and follows hired Agent Jobs through: reads results, answers input requests, reports.",
  releaseNote:
    "When I'm not sure a Coworker can do something, I now ask them first in a small group chat with you. And I keep track of Agents I hire: I answer their questions when I can, and tell you the result when they finish.",
  skills: [...v26.skills, "ask-coworker-first", "agent-jobs"],
};
