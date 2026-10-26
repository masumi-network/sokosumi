import type { SokoBotVersion } from "./types.js";
import { v29 } from "./v29.js";

export const v30: SokoBotVersion = {
  ...v29,
  id: "v30",
  name: "v30 · Jev mail triage",
  createdAt: "2026-10-23",
  summary:
    "v29 that reads mail Jev already tagged urgent, notable or bulk (urgent first, notable one line each, bulk as a count; woken between briefings only for urgent mail) and can ask Jev itself to judge many items the same way.",
  releaseNote:
    "I now sort your mail the same way every time: urgent first, notable in a line each, the rest only as a count. Between briefings I only interrupt you for urgent mail.",
  skills: [...v29.skills, "jev-triage"],
};
