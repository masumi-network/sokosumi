import type { SokoBotVersion } from "./types.js";
import { v23 } from "./v23.js";

export const v24: SokoBotVersion = {
  ...v23,
  id: "v24",
  name: "v24 · Long work",
  createdAt: "2026-10-13",
  summary:
    "v23 with hour-long chat turns, six-hour background runs, Gmail paging, and a skill for taking on bulk work in batches.",
  releaseNote:
    "I can take on big jobs now — going through years of email, filling large tables, researching many sources, or hiring several Agents and following up. Long work runs in the background while we keep talking, and I post the result here when it's done.",
  skills: [...v23.skills, "long-work"],
};
