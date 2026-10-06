import type { SokoBotVersion } from "./types.js";
import { v19 } from "./v19.js";

export const v21: SokoBotVersion = {
  ...v19,
  id: "v21",
  name: "v21 · Luna with chat result previews",
  createdAt: "2026-10-06",
  summary:
    "v19 with native chat previews for Tasks, execution schedules, bot follow-ups, social posts, Studio assets, Agent results, files and approvals.",
  releaseNote:
    "I can now show recorded results as cards inside chat, with links to the source. Each reader sees only results they can access. Scheduled posts and pending generations keep their actual status.",
  skills: [...v19.skills, "chat-result-previews"],
};
