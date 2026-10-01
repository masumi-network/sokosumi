import type { PresetRoute } from "./classifier";

/**
 * Routes for turns whose prompt Core writes itself. Core knows what each one
 * is for, so it grants that directly instead of asking a classifier to guess
 * from text it composed, much of it quoted from untrusted mail and task
 * comments. None of them may hire: that is the owner's call.
 */
export const SYSTEM_TURN_ROUTES = {
  /** New activity on followed or assigned Tasks: comment, update, follow up. */
  taskboard: {
    route: "DELEGATE_TASK",
    reason: "Taskboard update: work followed and assigned Tasks.",
  },
  /** Coworker and Job events on work the bot delegated. */
  events: {
    route: "DELEGATE_TASK",
    reason: "Delegation event: follow up on delegated work.",
  },
  /** New mail: flag what matters, change nothing. */
  "ingest:delta": {
    route: "DIRECT_RESPONSE",
    reason: "Inbox check: report what matters, change nothing.",
  },
  /** Morning briefing: brief, update memory follow-ups, propose work. */
  "ingest:briefing": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Morning briefing: brief and update memory follow-ups.",
  },
  /**
   * Daily stand-up: brief, nudge stuck work, start one Task when it is worth
   * it. No schedules, chat posts or files: on a quiet morning those tools
   * invited busywork in the behaviour lab.
   */
  standup: {
    route: "DELEGATE_TASK",
    writes: [
      "create_task",
      "assign_task",
      "find_coworkers",
      "reply_to_task",
      "link_tasks",
      "update_memory",
    ],
    reason: "Daily stand-up: nudge stuck work and draft requested Tasks.",
  },
  /** Weekly wrap: summarise and bring memory up to date. */
  "weekly-wrap": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Weekly wrap: summarise and update memory.",
  },
  /** Brief before an external meeting: read and report, change nothing. */
  "meeting-prep": {
    route: "DIRECT_RESPONSE",
    reason: "Meeting prep: brief the owner, change nothing.",
  },
  "end-of-day": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "End of day: summarise and note priorities.",
  },
  /** Offers drafts in chat; sending stays the owner's. */
  "follow-ups": {
    route: "DIRECT_RESPONSE",
    reason: "Follow-up chaser: report what waits, change nothing.",
  },
  "monday-plan": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Monday plan: plan the week and note it in memory.",
  },
  "monthly-review": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Monthly review: summarise and update memory.",
  },
  "memory-cleanup": {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Memory cleanup: drop stale goals and follow-ups.",
  },
} as const satisfies Record<string, PresetRoute>;

export function systemScheduleRoute(
  systemKey: string | null,
): PresetRoute | undefined {
  return systemKey && Object.hasOwn(SYSTEM_TURN_ROUTES, systemKey)
    ? SYSTEM_TURN_ROUTES[systemKey as keyof typeof SYSTEM_TURN_ROUTES]
    : undefined;
}
