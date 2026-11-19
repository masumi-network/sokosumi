import {
  capabilitiesForClassification,
  isSokoBotCapability,
  isSokoBotSandboxCapability,
  SOKO_BOT_CAPABILITIES,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { type PresetRoute, presetClassificationResult } from "./classifier";

/**
 * A mail check may also file attachments the owner's saved rules ask for
 * ("put invoices in Finance/Invoices"); nothing else it reads can change.
 */
function withMailFiling(preset: PresetRoute): PresetRoute {
  return {
    ...preset,
    capabilities: [
      ...capabilitiesForClassification(
        presetClassificationResult("", preset).classification,
      ),
      "save_email_attachment",
    ],
  };
}

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
  /** New mail: flag what matters, file what the owner's rules say. */
  "ingest:delta": withMailFiling({
    route: "DIRECT_RESPONSE",
    reason:
      "Inbox check: report what matters; file attachments only as the owner's saved rules say.",
  }),
  /** Morning briefing: brief, update memory follow-ups, propose work. */
  "ingest:briefing": withMailFiling({
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason:
      "Morning briefing: brief, update memory follow-ups, and file attachments the owner's saved rules ask for.",
  }),
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
  /** A Task the owner follows completed: read it and report, change nothing. */
  "task-summary": {
    route: "DIRECT_RESPONSE",
    reason:
      "Task summary: report what a followed Task delivered, change nothing.",
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
  dreaming: {
    route: "MANAGE_WORK",
    writeScope: "MEMORY",
    reason: "Dreaming: learn from recent activity and tidy memory.",
  },
  /**
   * CMO daily run: keeps the month the production run made current (gaps,
   * comments, news). Publishing is still gated by the approved strategy and
   * the subscription inside the social tools.
   */
  "cmo-daily-run": {
    route: "MANAGE_WORK",
    writeScope: "WORK",
    reason: "CMO daily run: finish gaps, reply to comments, adjust for news.",
  },
  /** CMO weekly review: measure, then improve or propose a better plan. */
  "cmo-weekly-review": {
    route: "MANAGE_WORK",
    writeScope: "WORK",
    reason: "CMO weekly review: measure and improve the strategy.",
  },
  /** CMO monthly strategy: plan next month from what was learned. */
  "cmo-monthly-strategy": {
    route: "MANAGE_WORK",
    writeScope: "WORK",
    reason: "CMO monthly strategy: write next month's strategy.",
  },
  /** CMO Brand Brain refresh: reads the open web, so it may not post. */
  "cmo-brand-refresh": {
    route: "MANAGE_WORK",
    writeScope: "WORK",
    sandbox: true,
    reason: "CMO Brand Brain refresh: re-read the website and update it.",
  },
  /** CMO strategy reminder: one friendly line, no tools. */
  "cmo-strategy-nudge": {
    route: "DIRECT_RESPONSE",
    reason: "CMO strategy reminder: remind the owner once.",
  },
} as const satisfies Record<string, PresetRoute>;

export function systemScheduleRoute(
  systemKey: string | null,
): PresetRoute | undefined {
  return systemKey && Object.hasOwn(SYSTEM_TURN_ROUTES, systemKey)
    ? SYSTEM_TURN_ROUTES[systemKey as keyof typeof SYSTEM_TURN_ROUTES]
    : undefined;
}

/**
 * A follow-up the bot wrote for itself runs with the tools of the turn that
 * wrote it, not a route Jev guesses from its prompt: "continue the CRM table
 * from March" must still be able to write rows. The writing turn had those
 * tools already, so the schedule grants nothing new. A schedule with no
 * stored tools was written by a person before console schedules stored
 * theirs, so it runs with a person's tools like one written today.
 */
export function inheritedScheduleRoute(
  capabilityNames: readonly string[],
): PresetRoute {
  const stored = capabilityNames.filter(isSokoBotCapability);
  const capabilities = stored.length ? stored : PERSON_SCHEDULE_CAPABILITIES;
  return {
    route: "DELEGATE_TASK",
    reason: "Schedule run, with the tools of whoever wrote it.",
    capabilities,
    sandbox: capabilities.some(isSokoBotSandboxCapability),
  };
}

/**
 * A run of a schedule the bot or owner wrote may always change or remove that
 * schedule, so "check until it is done" can end itself. The runtime limits
 * these extra tools to the run's own schedule.
 */
export const OWN_SCHEDULE_CAPABILITIES = [
  "update_schedule",
  "delete_schedule",
] as const satisfies readonly SokoBotCapability[];

/**
 * A schedule a person wrote in the console runs with the tools that person
 * gets in chat: its prompt is their own words, like a message, and Jev's
 * guess at it must not leave a weekly job read-only. Changing or removing
 * other schedules stays out; a run still reaches its own.
 */
export const PERSON_SCHEDULE_CAPABILITIES: readonly SokoBotCapability[] =
  SOKO_BOT_CAPABILITIES.filter(
    (capability) =>
      !(OWN_SCHEDULE_CAPABILITIES as readonly string[]).includes(capability),
  );

export function withOwnScheduleTools(
  capabilities: readonly SokoBotCapability[],
): SokoBotCapability[] {
  return [...new Set([...capabilities, ...OWN_SCHEDULE_CAPABILITIES])];
}

/**
 * Client turn id prefix of a followed Task's completion summary. Its reply
 * pushes like a Direct the owner never turned off, as other Task notices do.
 */
export const TASK_SUMMARY_CLIENT_TURN_PREFIX = "task-interest:";
