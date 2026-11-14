import {
  CMO_SCENARIOS,
  SOKO_BOT_SCENARIOS,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import {
  CMO_COMMENT_SCENARIO,
  CMO_EVAL_CASES,
  type CmoChatSetup,
  type CmoEvalCase,
} from "./eval-cmo-cases";

export const EVAL_SUITES = ["soko-bot", "cmo"] as const;
export type EvalSuite = (typeof EVAL_SUITES)[number];

interface EvalCaseCommon {
  id: string;
  suite: EvalSuite;
  /** Groups cases on the admin page: what part of the product this tests. */
  area: string;
  title: string;
  /** What we want to see, in one line. */
  intent: string;
  /** What this environment must have; without it the case is skipped. */
  requires?: "mailbox";
}

export type EvalCase =
  | (EvalCaseCommon & {
      kind: "scenario";
      /** The lane's personal Soko Bot, or its Cuso. */
      bot: "soko-bot" | "cuso";
      scenario: SokoBotScenario;
      /** What a Cuso case finds in its lane before the turn. */
      prepare?: CmoChatSetup;
    })
  | (EvalCaseCommon & CmoEvalCase);

/** Soko Bot scenarios by area, in the order they run: later ones use what earlier ones made. */
const SOKO_BOT_AREAS: Record<string, string> = {
  "delegate-with-daily-checkin": "Delegation",
  "coworker-question": "Coworkers",
  "coworker-failure": "Coworkers",
  "coworker-result": "Coworkers",
  "hire-agent-with-budget": "Hiring",
  "launch-plan-weekly-nudge": "Delegation",
  "status-rundown": "Board",
  "board-question": "Board",
  "ambiguous-request": "Judgment",
  "inbox-summary": "Mail and calendar",
  "calendar-prep": "Mail and calendar",
  "standup-with-inbox": "Rhythms",
  "chat-catch-up": "Chat",
  "chat-post": "Chat",
  "files-review": "Drive",
  "file-write": "Drive",
  "file-read": "Drive",
  "mail-delta": "Mail and calendar",
  "stop-checkins": "Schedules",
  "quiet-standup": "Rhythms",
  "quiet-delta": "Mail and calendar",
  "autonomous-meeting-prep": "Rhythms",
  "expensive-work-asks-first": "Hiring",
  "weekly-wrap": "Rhythms",
  dreaming: "Memory",
  "quick-research-task": "Delegation",
  "german-delegation": "Delegation",
  "web-research-with-sources": "Research",
  "workspace-data-work": "Research",
  "web-then-post-asks-first": "Judgment",
  "negated-hire": "Hiring",
  "parallel-comparison": "Research",
  "wait-then-hand-over": "Coworkers",
  "hand-over-on-completion": "Coworkers",
  "who-does-research": "Coworkers",
  "check-back-later": "Follow-ups",
  "archive-dropped-task": "Board",
  "remember-standing-rule": "Memory",
  "recall-standing-rule": "Memory",
  "contacts-add-and-find": "Contacts",
  "contacts-search": "Contacts",
  "table-from-chat": "Drive",
  "social-x-post": "Social",
  "social-linkedin-post": "Social",
  "social-drafts-rundown": "Social",
  "newsletter-send-now-goes-to-approval": "Newsletter",
  "newsletter-no-scraped-subscribers": "Newsletter",
};

/** Scenarios that read a connected mailbox or calendar; an eval lane has none. */
const NEEDS_MAILBOX = new Set([
  "inbox-summary",
  "calendar-prep",
  "standup-with-inbox",
  "mail-delta",
  "quiet-standup",
  "quiet-delta",
  "autonomous-meeting-prep",
]);

function scenarioCase(
  scenario: SokoBotScenario,
  suite: EvalSuite,
  area: string,
  prepare?: CmoChatSetup,
): EvalCase {
  return {
    id: scenario.id,
    suite,
    area,
    title: scenario.title,
    intent: scenario.intent,
    kind: "scenario",
    bot: suite === "cmo" ? "cuso" : "soko-bot",
    scenario,
    ...(prepare ? { prepare } : {}),
    ...(NEEDS_MAILBOX.has(scenario.id) ? { requires: "mailbox" as const } : {}),
  };
}

export const EVAL_CASES: readonly EvalCase[] = [
  ...SOKO_BOT_SCENARIOS.map((scenario) =>
    scenarioCase(scenario, "soko-bot", SOKO_BOT_AREAS[scenario.id] ?? "Other"),
  ),
  ...CMO_EVAL_CASES,
  ...CMO_SCENARIOS.map((scenario) =>
    scenarioCase(
      scenario,
      "cmo",
      "Chat",
      scenario.id === "cmo-asks-before-planning"
        ? "cmo-new-client"
        : "cmo-brand",
    ),
  ),
  scenarioCase(CMO_COMMENT_SCENARIO, "cmo", "Replies", "cmo-comments"),
];

export function evalCase(id: string): EvalCase | undefined {
  return EVAL_CASES.find((evalCase) => evalCase.id === id);
}

/** The cases a run covers, in run order; unknown ids are an error, not a silent skip. */
export function selectEvalCases(input: {
  suites: readonly EvalSuite[];
  caseIds: readonly string[];
}): EvalCase[] {
  const unknown = input.caseIds.filter((id) => !evalCase(id));
  if (unknown.length)
    throw new Error(`Unknown eval cases: ${unknown.join(", ")}`);
  return EVAL_CASES.filter(
    (evalCase) =>
      input.suites.includes(evalCase.suite) &&
      (input.caseIds.length === 0 || input.caseIds.includes(evalCase.id)),
  );
}
