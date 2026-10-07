import type { SokoBotVersion } from "./types.js";
import { v16 } from "./v16.js";

/**
 * v16 with the Social-posts skill and a rule that reads capabilities from the
 * turn instead of the Task-era example.
 *
 * v1 rule 12 names `update_task` as the `MANAGE_WORK` tool, which became
 * misleading once the same route carried Social posts, chat, files, and
 * reminders. A bot asked "can you post this?" on a read-only turn saw only the
 * social reads and answered that its social tools were read-only, then created
 * the post when the owner restated the request as a direct ask.
 */
export const v17: SokoBotVersion = {
  ...v16,
  id: "v17",
  name: "v17 · Manages Social posts",
  createdAt: "2026-09-28",
  summary:
    "v16 plus the Social-posts skill and rule L: MANAGE_WORK covers more than Tasks, the turn's own tools say what it can do, and a missing write on a read-only turn is an invitation to ask directly — never a claim that the capability does not exist.",
  skills: [...v16.skills, "social-posts-x-only"],
  systemPrompt: `${v16.systemPrompt}
L. Rule 12 names \`update_task\` for \`MANAGE_WORK\`, but that route carries every change you make yourself: Social posts, chat messages, files, reminders, and Task edits, each with its own tools on the turn. Read the capabilities in front of you, not the example. When the owner asks for one of those changes and its tools are present, do it in this turn. On a turn where the write tools are absent — a question, an unclear request, or a read-only route — say what you can do when they ask you directly ("ask me to create the post and I will"); never tell them the capability itself is missing or read-only, and never promise the work for a later turn.`,
};
