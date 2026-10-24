import type { SokoBotVersion } from "./types.js";
import { v30 } from "./v30.js";

const V30_FOLLOW_UPS =
  '- Check-ins, reminders, monitoring, and "tell me when" are schedules, not promises: `create_schedule` this turn (cron, timezone, a prompt naming the ids and what to check), after `list_schedules` to avoid duplicates; `update_schedule` / `delete_schedule` when plans change or work is done.';

const V31_FOLLOW_UPS = `- "When X is done, do Y" (give Hannah's findings to Alex, tell me when the Agent's report is in) is a follow-up plan, not a schedule: create or hire X now, assigned and READY, with \`followUp\` saying exactly what you will do with its result. Core wakes you when X completes, fails, or needs input, and hands you the plan; then do Y from X's actual result. Do not create Y early, poll, or start a background run only to wait. A follow-up runs without the sandbox and cannot hire: when Y is your own build work or a hire, use a background run instead (see Chained work).
- Check-ins at a set time, reminders, and recurring monitoring are schedules, not promises: \`create_schedule\` this turn (cron, timezone, a prompt naming the ids and what to check), after \`list_schedules\` to avoid duplicates; pass \`taskId\` or \`jobId\` when it only watches that work, so it ends with the work. When a schedule's purpose is done, \`delete_schedule\` it; one-time schedules remove themselves.`;

if (!v30.systemPrompt.includes(V30_FOLLOW_UPS))
  throw new Error("v31 expects v30's follow-up rule");

export const v31: SokoBotVersion = {
  ...v30,
  id: "v31",
  name: "v31 · Follow-up plans",
  createdAt: "2026-10-24",
  summary:
    "v30 that waits on delegated work with a follow-up plan instead of a schedule or a polling run, ends its own schedules, and reads contact kind, relationship, and reply state.",
  releaseNote:
    "Three things are new. Your mail is sorted the same way every time: urgent first, notable in a line each, the rest only as a count, and between briefings I only interrupt you for urgent mail. When you ask me to pass someone's finished work on to someone else, I hand it over the moment it is done, without reminders piling up. And in your contacts I tell people apart from companies and shared inboxes, and point out who has not replied.",
  systemPrompt: v30.systemPrompt.replace(V30_FOLLOW_UPS, V31_FOLLOW_UPS),
  skills: v30.skills.map((skill) =>
    skill === "long-and-chained-work"
      ? "long-and-chained-work-follow-ups"
      : skill === "team-contacts"
        ? "team-contacts-relationships"
        : skill,
  ),
};
