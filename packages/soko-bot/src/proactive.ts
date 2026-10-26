/**
 * The prompt tells a bot with nothing worth saying to answer exactly
 * `Nothing to add.` — this recognises that, so silence stays silence instead
 * of becoming a message nobody wanted. Callers treat it as a successful turn
 * that posts nothing.
 */
export function isSokoBotSilentAnswer(
  answer: string | null | undefined,
): boolean {
  const trimmed = answer?.trim() ?? "";
  return (
    trimmed.length === 0 ||
    /^nothing (new worth flagging|to add)\.?$/i.test(trimmed)
  );
}

/**
 * What a Soko Bot does on its own: fixed rhythms (system schedules) and
 * deterministic triggers. Single source for Core's behaviour and the
 * console's "How it works" explanation.
 */
export interface SokoBotSystemSchedule {
  key:
    | "standup"
    | "weekly-wrap"
    | "meeting-prep"
    | "end-of-day"
    | "follow-ups"
    | "monday-plan"
    | "monthly-review"
    | "memory-cleanup";
  name: string;
  /** Cron in the bot's timezone. */
  cronExpression: string;
  description: string;
  prompt: string;
  /**
   * The same rhythm for a shared bot, which has no owner and speaks to the
   * whole team. A rhythm without one is not offered to shared bots.
   */
  promptShared?: string;
}

/**
 * The shape every check-in answers in, which chat renders as a card: a
 * headline, short headed sections, and the numbers last.
 */
export const SOKO_BOT_BRIEF_FORMAT =
  'Write it as a brief. First line: one plain sentence saying what matters most (no heading, no label). Then 2 to 4 sections, each a "### " heading of one to three words followed by 1 to 4 "- " bullets of one line each. If you quote counts, put them last on one line starting "Numbers: " with items separated by " · " (for example: Numbers: 11 Tasks created · 9 completed · 3,816 credits). Talk to the reader, never about your input: no "in the packet" or "in the information provided". Skip empty sections.';

const brief = (prompt: string) => `${prompt} ${SOKO_BOT_BRIEF_FORMAT}`;

export const SOKO_BOT_SYSTEM_SCHEDULES: readonly SokoBotSystemSchedule[] = [
  {
    key: "standup",
    name: "Daily stand-up",
    cronExpression: "0 8 * * 1-5",
    description:
      "Weekday mornings: today's meetings, a summary of yesterday's mail, and what is stuck on the board.",
    prompt: brief(
      'Daily stand-up. Using the packet below, give the owner one short brief (under 14 lines): 1) today\'s calendar with times and who with, 2) a summary of the last 24 hours of mail: what needs them first, then the rest grouped in one line (for example 4 newsletters, 2 receipts), 3) items under "Needs attention" and what you did about each in this turn (nudge the Coworker with reply_to_task in one concrete sentence, ask the owner one question, or reschedule), 4) follow-ups due from memory, 5) anything under "Due within 48h", once. If a mail is an explicit request to the owner with a deliverable and a date (an invoice due, a signature, a deadline someone set), create the DRAFT Task for it in this turn, assigned to the owner and in the project it fits, and name it in the brief. End with one short line on what the team has been working on, from "Team activity", as a side note: who and what, no detail. Team Tasks are context only — never nudge or comment on those. When every section is empty, answer exactly: Nothing to add.',
    ),
    promptShared: brief(
      'Daily stand-up for the team. Using the packet below, give the team one short brief (under 14 lines): 1) today\'s calendar with times and who with, 2) a summary of the last 24 hours of mail in the connected accounts: what needs the team first, then the rest grouped in one line, 3) items under "Needs attention" and what you did about each in this turn (nudge the Coworker with reply_to_task in one concrete sentence, or ask the team one question), 4) follow-ups due from memory, 5) anything under "Due within 48h", once. End with one short line on what the team has been working on, from "Team activity". When every section is empty, answer exactly: Nothing to add.',
    ),
  },
  {
    key: "weekly-wrap",
    name: "Weekly wrap & next week",
    cronExpression: "0 16 * * 5",
    description:
      "Friday afternoon: what got done, what slipped, and what is queued for next week.",
    prompt: brief(
      'Weekly wrap. Using the packet below and get_task_status where needed: what got done this week (only Tasks whose status is COMPLETED; RUNNING or waiting for input is still in progress, FAILED slipped), what slipped and why, what is queued for next week, and one decision the owner should make, as the headline when it matters most. Take the Numbers line from "This week in numbers" (Tasks completed, your turns, credits). Compare with the Monday plan in memory if there is one. Update memory (goals, follow-ups, blockers) to match. Under 14 lines; when nothing moved this week, say so in one line.',
    ),
    promptShared: brief(
      'Weekly wrap for the team. Using the packet below and get_task_status where needed: what got done this week (only Tasks whose status is COMPLETED; RUNNING or waiting for input is still in progress, FAILED slipped), what slipped and why, what is queued for next week, and one decision the team should make. Take the Numbers line from "This week in numbers". Compare with the Monday plan in memory if there is one. Update memory (goals, follow-ups, blockers) to match. Under 14 lines; when nothing moved this week, say so in one line.',
    ),
  },
  {
    key: "meeting-prep",
    name: "Meeting prep",
    cronExpression: "*/30 7-19 * * 1-5",
    description:
      "Before a meeting with people from outside: who is coming, your last mail with them, and related open Tasks.",
    prompt: brief(
      "Meeting prep. A meeting with people from outside starts within the hour. Give the owner a short brief (under 12 lines): who is coming and from where, what was last said with them by mail, open Tasks connected to them, and anything still unanswered. The headline names the meeting, its time, and what to get out of it. The packet below is a starting point: when it has no real mail with someone, look them up yourself with search_inbox (their name, their company or domain) and read_email for the thread that matters. Say no mail was found only after you have searched. When there is nothing useful beyond the meeting itself, answer exactly: Nothing to add.",
    ),
  },
  {
    key: "end-of-day",
    name: "End of day",
    cronExpression: "30 17 * * 1-5",
    description:
      "Weekday evenings: what got done, what waits on you, tomorrow's first meeting, three priorities.",
    prompt: brief(
      "End of day. From the packet below, in under 12 lines: what got done today, what is waiting on the owner, tomorrow's first meeting with its time, and three priorities you suggest for tomorrow, each with a reason. When nothing happened and nothing waits, answer exactly: Nothing to add.",
    ),
    promptShared: brief(
      "End of day for the team. From the packet below, in under 12 lines: what got done today, what is waiting on the team, tomorrow's first meeting with its time, and three priorities you suggest for tomorrow, each with a reason. When nothing happened and nothing waits, answer exactly: Nothing to add.",
    ),
  },
  {
    key: "follow-ups",
    name: "Follow-up chaser",
    cronExpression: "0 10 * * 1-5",
    description:
      "Weekday mornings, only when it matters: mail waiting on your answer, and mail you sent that nobody answered.",
    prompt:
      'Follow-up chaser. "Waiting on you" lists mail that asks the owner something and is a few days old; "Waiting on others" lists mail the owner sent that got no reply. Raise only the ones that genuinely need action, at most five, each in one line with who and what. For mail the owner sent, offer to draft a short nudge; never send anything. When none needs action, answer exactly: Nothing to add.',
  },
  {
    key: "monday-plan",
    name: "Monday plan",
    cronExpression: "0 9 * * 1",
    description:
      "Monday mornings: how full the week is, deadlines, your goals, and where to protect time.",
    prompt: brief(
      'Monday plan. From the packet below and your memory, plan the owner\'s week. Headline: what this week is about, in one sentence. Sections: This week (how full the calendar is, the busiest days, deadlines with their dates), Focus (two or three priorities from the goals you know of, each with when to work on it and why), and Watch (blockers or risks, only if there are any). Numbers last, from "Last week in numbers". Under 14 lines. Write the three focus points into memory follow-ups dated this Friday, so the weekly wrap can check them. When the week is empty and there are no goals, answer exactly: Nothing to add.',
    ),
    promptShared: brief(
      'Monday plan for the team. From the packet below and your memory, plan the team\'s week. Headline: what this week is about, in one sentence. Sections: This week (how full the calendar is, the busiest days, deadlines with their dates), Focus (two or three team priorities, each with why), and Watch (blockers or risks, only if there are any). Numbers last, from "Last week in numbers". Under 14 lines. Write the three focus points into memory follow-ups dated this Friday, so the weekly wrap can check them. When the week is empty and there are no goals, answer exactly: Nothing to add.',
    ),
  },
  {
    key: "monthly-review",
    name: "Monthly review",
    cronExpression: "0 9 1 * *",
    description:
      "First of the month: progress on your goals, what last month's work cost, and invoices or subscriptions seen in mail.",
    prompt: brief(
      "Monthly review. Open with a \"Last 31 days\" section of 4 to 5 short bullets: the owner's Tasks (created, completed, failed, how many through you), chat (the owner's messages, your turns), credits (total, yours, the top Coworkers), and the team (who completed what). Then progress on the goals in your memory, recurring invoices or subscriptions seen in mail (name, amount if shown, how often), two or three insights the numbers show, and one thing to change. Under 16 lines. Quote the numbers as given; never estimate them. Tasks the packet names as someone else's are not the owner's. When there is nothing to review, answer exactly: Nothing to add.",
    ),
    promptShared: brief(
      'Monthly review for the team. Open with a "Last 31 days" section of 3 to 4 short bullets: chat (your turns and messages), credits (total, yours, the top Coworkers), and the team (who completed what). Then progress on the team goals in your memory, recurring invoices or subscriptions seen in connected mail (name, amount if shown, how often), two or three insights the numbers show, and one thing to change. Under 16 lines. Quote the numbers as given; never estimate them. When there is nothing to review, answer exactly: Nothing to add.',
    ),
  },
  {
    key: "memory-cleanup",
    name: "Memory cleanup",
    cronExpression: "0 18 * * 0",
    description:
      "Sunday evenings, silently: drops goals and follow-ups that are done or out of date.",
    prompt:
      "Memory cleanup. Using your memory and the packet below, remove goals and follow-ups that are done, refer to Tasks that are closed or belong to someone else, or whose date passed more than a week ago, with update_memory. Keep everything still relevant. Say nothing to the owner unless you dropped a goal they should know about; otherwise answer exactly: Nothing to add.",
    promptShared:
      "Memory cleanup. Using your memory and the packet below, remove goals and follow-ups that are done, refer to Tasks that are closed or outside what you can see, or whose date passed more than a week ago, with update_memory. Keep everything still relevant. Say nothing to the team unless you dropped a goal they should know about; otherwise answer exactly: Nothing to add.",
  },
];

/**
 * The prompt a bot runs a built-in rhythm with, or null when the rhythm is
 * not offered to a shared bot.
 */
export function sokoBotSystemSchedulePrompt(
  schedule: SokoBotSystemSchedule,
  shared: boolean,
): string | null {
  return shared ? (schedule.promptShared ?? null) : schedule.prompt;
}

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
      "Connected mailboxes are checked hourly, but you are only interrupted for mail that needs you soon; the rest is summarised in the morning. A clear request with a deadline becomes a draft Task you can promote. Meetings within a day with an agenda you own get a prep draft.",
  },
  {
    id: "memory",
    title: "Remembers follow-ups",
    description:
      "Follow-ups it noted with a date come back on the day; it raises each once.",
  },
  {
    id: "autonomy",
    title: "Starts work when it is worth it",
    description:
      "It can start a Task on its own — preparing a meeting from your calendar, the obvious next step after research it did for you — and always tells you in chat what it started and why. When the work looks expensive it asks first instead.",
  },
  {
    id: "limits",
    title: "Stays within its limits",
    description:
      "Never sends mail on its own. One initiative per turn, capped by your daily limit, and at most three comments per Task per day. Pause everything it starts on its own at any time.",
  },
];

export interface SokoBotDueFollowUp {
  text: string;
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

/** Memory follow-ups dated after today and within `days`, in the bot's timezone. */
export function upcomingFollowUps(
  followUps: readonly string[],
  now: Date,
  timeZone: string,
  days: number,
): SokoBotDueFollowUp[] {
  const today = localDate(now, timeZone);
  const until = localDate(
    new Date(now.getTime() + days * 86_400_000),
    timeZone,
  );
  return followUps.flatMap((entry) => {
    const date = ISO_DATE.exec(entry)?.[0];
    return date && date > today && date <= until
      ? [{ text: entry.trim(), date, overdue: false }]
      : [];
  });
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
