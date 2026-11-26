import type { SokoBotVersion } from "./types.js";
import { v36 } from "./v36.js";
import { X_DMS_SKILL_ID } from "./x-dms-skills.js";

export const v37: SokoBotVersion = {
  ...v36,
  id: "v37",
  name: "v37 · X direct messages",
  createdAt: "2026-11-25",
  summary:
    "v36 that reads the owner's X direct messages like mail: triaged by Jev into the briefing and stand-up, urgent ones flagged between them, listed on request through search_inbox, private to the owner, and never answered on X on its own.",
  releaseNote:
    "I now check your X direct messages like your mail: they're in your morning briefing, I tell you right away when one is urgent, and you can ask me \"any new X DMs?\". They stay between us, and I never reply on X on my own: I'll draft an answer for you instead.",
  skills: v36.skills.map((skill) =>
    skill === "inbox-and-calendar" ? X_DMS_SKILL_ID : skill,
  ),
};
