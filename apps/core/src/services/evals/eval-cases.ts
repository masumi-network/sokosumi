import {
  CMO_SCENARIOS,
  SEO_SCENARIOS,
  SOKO_BOT_SCENARIOS,
} from "@sokosumi/soko-bot";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";
import { CHAT_IDENTITY_SCENARIO } from "./eval-chat-identity";
import {
  CMO_COMMENT_SCENARIO,
  CMO_EVAL_CASES,
  type CmoChatSetup,
  type CmoEvalCase,
} from "./eval-cmo-cases";
import {
  COMPETITOR_ADS_CASE_ID,
  COMPETITOR_LANDING_PAGE_CASE_ID,
} from "./eval-cmo-competitor-ads";
import {
  COMPETITOR_CASE_SETUPS,
  isCompetitorEvalCase,
} from "./eval-cmo-competitors";
import { CMO_ADS_CASE_ID, CMO_FUNNEL_CASE_ID } from "./eval-cmo-funnel";
import { isCmoSeoReportCase } from "./eval-cmo-seo-report";
import { CMO_CORRECTION_CASE_ID } from "./eval-cmo-variety";
import { CONTEXT_ON_DEMAND_SCENARIOS } from "./eval-context-on-demand";
import { MEETING_PREP_SCENARIO } from "./eval-meeting-prep";
import {
  MOVE_TO_TASK_SCHEDULE_SCENARIO,
  SCHEDULES_SCENARIO,
} from "./eval-schedules";
import type { StandupEvalSetup } from "./eval-standup";
import {
  HOLDOUT_PREFIX,
  HOLDOUT_REPEATS,
  holdoutJourneys,
} from "./ownerbench/holdout";
import { OWNER_JOURNEYS, type OwnerJourney } from "./ownerbench/journeys";

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
      scenario: LabScenario;
      /** What a Cuso case finds in its lane before the turn. */
      prepare?: CmoChatSetup;
    })
  | (EvalCaseCommon & CmoEvalCase)
  | (EvalCaseCommon & {
      /** The organization's daily agent stand-up, run by Core in the lane. */
      kind: "standup";
      setup: StandupEvalSetup;
    })
  | (EvalCaseCommon & {
      /** An owner benchmark journey: several steps, checked and judged as one. */
      kind: "journey";
      journey: OwnerJourney;
    });

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
  "followed-tasks": "Board",
  "ambiguous-request": "Judgment",
  "competitor-week": "Competitors",
  "mcp-read-issues": "MCP servers",
  "mcp-uses-server-not-web": "MCP servers",
  "mcp-write-asked": "MCP servers",
  "mcp-ignores-injected-orders": "MCP servers",
  "announcement-not-for-every-bot": "Judgment",
  "inbox-summary": "Mail and calendar",
  "calendar-prep": "Mail and calendar",
  "standup-with-inbox": "Rhythms",
  "chat-catch-up": "Chat",
  "chat-post": "Chat",
  "talking-video": "Social",
  "files-review": "Drive",
  "file-write": "Drive",
  "file-read": "Drive",
  "mail-delta": "Mail and calendar",
  "stop-checkins": "Schedules",
  "reminder-uses-owner-zone": "Schedules",
  "reminder-named-zone-wins": "Schedules",
  "quiet-standup": "Rhythms",
  "quiet-delta": "Mail and calendar",
  "x-dm-standup": "Mail and calendar",
  "x-dm-urgent": "Mail and calendar",
  "x-dm-bulk": "Mail and calendar",
  "x-dm-ask": "Mail and calendar",
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
  "soko-bot-landing-page-playbook": "Writing",
  "fundraising-pipeline-off": "Fundraising",
  "fundraising-find-investors-off": "Fundraising",
  "table-from-chat": "Drive",
  "social-x-post": "Social",
  "social-linkedin-post": "Social",
  "social-drafts-rundown": "Social",
  "newsletter-send-now-goes-to-approval": "Newsletter",
  "newsletter-no-scraped-subscribers": "Newsletter",
  "break-task-into-subtasks": "Delegation",
  "move-task-under-parent": "Delegation",
  "a2a-ask-and-relay": "Agent to agent",
  "a2a-remembers-answer": "Agent to agent",
  "a2a-structured-handoff": "Agent to agent",
  "a2a-multi-turn": "Agent to agent",
  "a2a-asks-back": "Agent to agent",
  "a2a-no-answer": "Agent to agent",
  "a2a-long-reply": "Agent to agent",
  "a2a-several-messages": "Agent to agent",
  "a2a-bot-to-bot": "Agent to agent",
  "a2a-coworker-declines": "Agent to agent",
  "a2a-who-to-ask": "Agent to agent",
  "a2a-hop-limit": "Agent to agent",
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
  scenario: LabScenario,
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
  scenarioCase(MEETING_PREP_SCENARIO, "soko-bot", "Mail and calendar"),
  scenarioCase(CHAT_IDENTITY_SCENARIO, "soko-bot", "Chat"),
  scenarioCase(SCHEDULES_SCENARIO, "soko-bot", "Schedules"),
  scenarioCase(MOVE_TO_TASK_SCHEDULE_SCENARIO, "soko-bot", "Schedules"),
  ...CONTEXT_ON_DEMAND_SCENARIOS.map((scenario) =>
    scenarioCase(scenario, "soko-bot", "Context"),
  ),
  ...SEO_SCENARIOS.map((scenario) => scenarioCase(scenario, "soko-bot", "SEO")),
  {
    id: "standup-quiet",
    suite: "soko-bot",
    area: "Stand-up",
    title: "A quiet day posts nothing",
    intent: "With nothing done, due or blocked, the stand-up posts nothing.",
    kind: "standup",
    setup: "quiet",
  },
  {
    id: "standup-match",
    suite: "soko-bot",
    area: "Stand-up",
    title: "The bots speak, Coworker work inside, one hand-off",
    intent:
      "After a short opener only the bots post: Robin's bot tells what Mira did and is doing for Robin, and her Task waiting for Robin mentions him; Mira posts nothing of her own, a private Task stays out, and the DACH need opens a hand-off to Mira under Robin's bot's message, which she answers.",
    kind: "standup",
    setup: "match",
  },
  {
    id: "standup-no-match",
    suite: "soko-bot",
    area: "Stand-up",
    title: "No hand-off when nobody's work fits",
    intent:
      "Robin's bot names the need no agent's work touches (booking the offsite venue) in its own message, but no hand-off opens.",
    kind: "standup",
    setup: "no-match",
  },
  {
    id: "standup-week",
    suite: "soko-bot",
    area: "Stand-up",
    title: "Week in review names public work only",
    intent:
      "The weekly thread gives Robin a line naming the public Task he finished, leaves his private Task out, and says where to turn it off.",
    kind: "standup",
    setup: "week",
  },
  ...CMO_EVAL_CASES,
  ...CMO_SCENARIOS.map((scenario) =>
    isCompetitorEvalCase(scenario.id)
      ? scenarioCase(
          scenario,
          "cmo",
          "Competitors",
          COMPETITOR_CASE_SETUPS[
            scenario.id as keyof typeof COMPETITOR_CASE_SETUPS
          ],
        )
      : scenario.id === COMPETITOR_ADS_CASE_ID
        ? scenarioCase(scenario, "cmo", "Competitors", "cmo-competitor-ads")
        : scenario.id === COMPETITOR_LANDING_PAGE_CASE_ID
          ? scenarioCase(
              scenario,
              "cmo",
              "Competitors",
              "cmo-competitor-landing-page",
            )
          : scenarioCase(
              scenario,
              "cmo",
              "Chat",
              scenario.id === "cmo-asks-before-planning"
                ? "cmo-new-client"
                : scenario.id === "cmo-reads-last-weeks-report"
                  ? "cmo-report"
                  : scenario.id === "cmo-change-request" ||
                      scenario.id === "cmo-chat-strategy-skill" ||
                      scenario.id === "cmo-change-then-drafts" ||
                      scenario.id === "cmo-video-shapes-alsoon" ||
                      scenario.id === "cmo-mixed-clear-and-open" ||
                      scenario.id === "cmo-owner-delegates-choice" ||
                      scenario.id === "cmo-reads-week-four" ||
                      scenario.id === "cmo-change-reply-plain" ||
                      scenario.id === CMO_CORRECTION_CASE_ID ||
                      scenario.id === CMO_FUNNEL_CASE_ID
                    ? "cmo-plan"
                    : scenario.id === CMO_ADS_CASE_ID
                      ? "cmo-plan-ads"
                      : scenario.id === "cmo-seo-skipped-idea"
                        ? "cmo-seo-skipped"
                        : scenario.id === "cmo-weekly-review-last-week" ||
                            scenario.id === "cmo-daily-run-watch"
                          ? "cmo-weekly-review"
                          : isCmoSeoReportCase(scenario.id)
                            ? "cmo-seo-report"
                            : "cmo-brand",
            ),
  ),
  scenarioCase(CMO_COMMENT_SCENARIO, "cmo", "Replies", "cmo-comments"),
  ...[
    ...OWNER_JOURNEYS.map((journey) => ({ journey, area: "Owner bench" })),
    // Loaded from a file outside the repository when a run names one.
    ...holdoutJourneys().map((journey) => ({
      journey,
      area: "Owner bench (held out)",
    })),
  ].map(
    ({ journey, area }): EvalCase => ({
      id: journey.id,
      suite: journey.bot === "cuso" ? "cmo" : "soko-bot",
      area,
      title: journey.title,
      intent: journey.intent,
      kind: "journey",
      journey,
    }),
  ),
];

/** The owner benchmark's cases; they run only when named (`evals:local --ownerbench`). */
export const OWNER_BENCH_CASE_IDS: readonly string[] = OWNER_JOURNEYS.map(
  (journey) => journey.id,
);

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
  // Owner journeys run many turns each, so a suite run leaves them out.
  const selected = EVAL_CASES.filter(
    (evalCase) =>
      input.suites.includes(evalCase.suite) &&
      (input.caseIds.length === 0
        ? evalCase.kind !== "journey"
        : input.caseIds.includes(evalCase.id)),
  );
  // Other cases build on each other in registry order. Each journey sets up
  // its own world, so named journeys run in the order named: running two
  // both ways shows whether one leaks into the other.
  const rank = (evalCase: EvalCase) =>
    evalCase.kind === "journey" ? input.caseIds.indexOf(evalCase.id) : -1;
  return [
    ...selected.filter((evalCase) => evalCase.kind !== "journey"),
    ...selected
      .filter((evalCase) => evalCase.kind === "journey")
      .sort((a, b) => rank(a) - rank(b)),
  ];
}

/** Scenario cases end in a judge's verdict; the others are scored by checks alone. */
export function isJudgedEvalCase(evalCase: EvalCase): boolean {
  return evalCase.kind === "scenario" || evalCase.kind === "journey";
}

/** Runs a case gets whatever the run asked: a held-out journey is read as pass^1 and pass^3. */
export function minimumEvalRepeats(evalCase: EvalCase): number {
  return evalCase.kind === "journey" &&
    evalCase.journey.id.startsWith(HOLDOUT_PREFIX)
    ? HOLDOUT_REPEATS
    : 1;
}
