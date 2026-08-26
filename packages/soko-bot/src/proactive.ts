/**
 * What a Soko Bot does on its own: fixed rhythms (system schedules) and
 * deterministic triggers. Single source for Core's behaviour and the
 * console's "How it works" explanation.
 */
export interface SokoBotSystemSchedule {
  key: "standup" | "weekly-wrap";
  name: string;
  /** Cron in the bot's timezone. */
  cronExpression: string;
  /** Owner-facing one-liner. */
  description: string;
  /** What the bot is asked to do; Core appends the live packet. */
  prompt: string;
}

export const SOKO_BOT_SYSTEM_SCHEDULES: readonly SokoBotSystemSchedule[] = [
  {
    key: "standup",
    name: "Daily stand-up",
    cronExpression: "0 8 * * 1-5",
    description:
      "Weekday mornings: today's meetings, mail that needs you, and what is stuck on the board.",
    prompt:
      'Daily stand-up. Using the packet below, give the owner one short brief (under 12 lines): 1) today\'s calendar with times and who with, 2) mail that needs them, 3) items under "Needs attention" and what you did about each in this turn (nudge the Coworker with reply_to_task in one concrete sentence, ask the owner one question, or reschedule), 4) follow-ups due from memory. "Open on the board" is context only — never nudge or comment on those. Skip empty sections.',
  },
  {
    key: "weekly-wrap",
    name: "Weekly wrap & next week",
    cronExpression: "0 16 * * 5",
    description:
      "Friday afternoon: what got done, what slipped, and what is queued for next week.",
    prompt:
      "Weekly wrap. Using the packet below and get_task_status where needed: what got done this week, what slipped and why, what is queued for next week, and one decision the owner should make. Update memory (goals, follow-ups, blockers) to match. Under 15 lines.",
  },
];

export interface SokoBotProactiveRule {
  id: string;
  title: string;
  description: string;
}

/** Owner-facing explanation of every trigger that can make the bot act. */
export const SOKO_BOT_PROACTIVE_RULES: readonly SokoBotProactiveRule[] = [
  {
    id: "assigned",
    title: "Works Tasks assigned to it",
    description:
      "Anyone in the workspace can assign it a Task. It reads the Task, does it or delegates parts, and reports on the Taskboard.",
  },
  {
    id: "coworkers",
    title: "Keeps delegated work moving",
    description:
      "When a Coworker asks a question, fails, or finishes, it answers, restarts with guidance, or creates the follow-up.",
  },
  {
    id: "stale",
    title: "Nudges stuck work",
    description:
      "A Task running for over a day, a question unanswered for four hours, or a failure nobody picked up gets one nudge per day.",
  },
  {
    id: "inbox",
    title: "Reads mail and calendar",
    description:
      "Connected mailboxes are checked hourly; a clear request with a deadline becomes a draft Task you can promote. Meetings within a day with an agenda you own get a prep draft.",
  },
  {
    id: "memory",
    title: "Remembers follow-ups",
    description:
      "Follow-ups it noted with a date come back on the day; it raises each once.",
  },
  {
    id: "limits",
    title: "Stays quiet by design",
    description:
      "Never sends mail, never hires or starts work on its own — only drafts, comments, and messages to you. At most three comments per Task per day.",
  },
];

export interface SokoBotDueFollowUp {
  text: string;
  /** YYYY-MM-DD found in the entry. */
  date: string;
  overdue: boolean;
}

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Memory follow-ups whose ISO date is today or in the past, in the bot's timezone. */
export function dueFollowUps(
  followUps: readonly string[],
  now: Date,
  timeZone: string,
): SokoBotDueFollowUp[] {
  const today = localDate(now, timeZone);
  const due: SokoBotDueFollowUp[] = [];
  for (const entry of followUps) {
    const match = ISO_DATE.exec(entry);
    if (!match) continue;
    const date = match[0];
    if (date > today) continue;
    due.push({ text: entry.trim(), date, overdue: date < today });
  }
  return due;
}
