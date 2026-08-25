import type { SokoBotTurnRoute } from "@/lib/clients/generated/core";

import type { ChatTurnDetail } from "./chat-state";

/**
 * Behaviour scenarios: fixed prompts with the reaction we expect from the
 * assistant. Run them from the console after changing the system prompt,
 * classifier, or model to see whether the behaviour still holds. Prompts
 * are fixtures, so they stay in English regardless of the UI locale.
 *
 * They are ordered: later ones build on schedules earlier ones create, so
 * "Run all" exercises create → inspect → clean up.
 */
export interface SokoBotScenario {
  id: string;
  title: string;
  /** What we want to see, in one line. */
  intent: string;
  prompt: string;
  expect: {
    routes: SokoBotTurnRoute[];
    /** Every one of these tools must be called. */
    tools?: string[];
    /** At least one of these tools must be called. */
    anyTools?: string[];
    /** None of these may be called. */
    forbiddenTools?: string[];
    /** Minimum number of tasks/jobs the turn touched. */
    minDelegations?: number;
    /** Nothing may be delegated. */
    noDelegations?: boolean;
    /** The answer must ask the owner something. */
    asksQuestion?: boolean;
    /** The answer must not promise a later check without a schedule. */
    noEmptyPromise?: boolean;
    /** Every UUID in the answer must appear in a tool result or delegation. */
    noInventedIds?: boolean;
  };
}

export const SOKO_BOT_SCENARIOS: SokoBotScenario[] = [
  {
    id: "delegate-with-daily-checkin",
    title: "Delegate a brief and check in daily",
    intent:
      "Creates the task, finds a teammate, and sets up a real daily follow-up schedule instead of promising one.",
    prompt:
      "Create a task for a one-page research brief on the top 5 EU AI-agent marketplaces (pricing, positioning, funding), due end of next week, and assign it to whoever on the team handles research (leave it unassigned and tell me if nobody fits). Then check on it every weekday at 9:00 Europe/Berlin and nudge me if it is not moving.",
    expect: {
      routes: ["DELEGATE_TASK", "MIXED"],
      tools: ["create_task", "create_schedule"],
      forbiddenTools: ["hire_agent"],
      minDelegations: 1,
      noEmptyPromise: true,
      noInventedIds: true,
    },
  },
  {
    id: "hire-agent-with-budget",
    title: "Hire an agent under a budget",
    intent:
      "Finds an agent, checks its input, and hires only within the stated budget.",
    prompt:
      "Find an agent in the marketplace that can write SEO blog posts, check what input it needs, and hire it to write an 800-word post on 'AI agents for accounting teams'. Spend at most 10 credits; if nothing fits that budget, tell me instead of hiring.",
    expect: {
      routes: ["HIRE_AGENT", "MIXED"],
      tools: ["find_agents"],
      forbiddenTools: ["create_task"],
      noInventedIds: true,
    },
  },
  {
    id: "launch-plan-weekly-nudge",
    title: "Break a launch into tasks with a weekly nudge",
    intent:
      "Creates several draft tasks, stores the date in memory, and schedules the weekly reminder.",
    prompt:
      "We are launching the coworker marketplace on September 15. Break this into 3 to 4 tasks (announcement copy, landing page update, partner outreach, internal QA), create them as drafts, remember that launch is September 15, and remind me every Monday at 10:00 Europe/Berlin about what is still open until then.",
    expect: {
      routes: ["DELEGATE_TASK", "MIXED"],
      tools: ["create_task", "create_schedule"],
      anyTools: ["update_memory"],
      forbiddenTools: ["hire_agent"],
      minDelegations: 3,
      noInventedIds: true,
    },
  },
  {
    id: "status-rundown",
    title: "Status rundown of open work",
    intent: "Reads state and reports; creates nothing new.",
    prompt:
      "Give me a status rundown of all my open tasks and the follow-ups you have scheduled, flag anything idle for more than 3 days, and for the oldest idle task draft a short note I could send to the assignee.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "MIXED"],
      anyTools: ["list_schedules", "refresh_context", "get_task_status"],
      forbiddenTools: ["create_task", "hire_agent", "create_schedule"],
      noDelegations: true,
    },
  },
  {
    id: "ambiguous-request",
    title: "Ambiguous request",
    intent: "Asks one clarifying question instead of guessing.",
    prompt:
      "Sort out the thing with the client from last week and make sure it is handled before Friday.",
    expect: {
      routes: ["CLARIFY"],
      forbiddenTools: ["create_task", "hire_agent", "assign_task"],
      noDelegations: true,
      asksQuestion: true,
    },
  },
  {
    id: "stop-checkins",
    title: "Stop the check-ins",
    intent:
      "Lists its schedules and removes the ones the owner no longer wants; touches no tasks.",
    prompt:
      "Stop checking in on the EU marketplace research brief and drop the weekly launch reminder; I will track both myself. Keep everything else as it is.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "MIXED"],
      anyTools: ["delete_schedule", "update_schedule"],
      forbiddenTools: ["create_task", "create_schedule", "hire_agent"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
];

export interface ScenarioCheck {
  label: string;
  pass: boolean;
  actual: string;
}

export interface ScenarioResult {
  checks: ScenarioCheck[];
  passed: number;
  total: number;
}

function calledTools(turn: ChatTurnDetail): Set<string> {
  const names = new Set(turn.toolCalls.map((call) => call.capability));
  for (const event of turn.events) {
    if (event.type === "actions.requested" && event.toolName) {
      names.add(event.toolName);
    }
  }
  return names;
}

function list(values: Iterable<string>): string {
  const items = Array.from(values);
  return items.length > 0 ? items.join(", ") : "none";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const EMPTY_PROMISE =
  /\b(I(?:'ll| will) (?:check|follow up|remind|monitor|keep an eye)|will check back|check back later)\b/i;

export function evaluateScenario(
  scenario: SokoBotScenario,
  turn: ChatTurnDetail,
): ScenarioResult {
  const { expect } = scenario;
  const tools = calledTools(turn);
  const answer = turn.finalAnswer ?? "";
  const checks: ScenarioCheck[] = [];

  checks.push({
    label: "Completed",
    pass: turn.status === "COMPLETED",
    actual: turn.status,
  });
  const failedTools = turn.toolCalls.filter((call) => call.status === "FAILED");
  checks.push({
    label: "No failed tool calls",
    pass: failedTools.length === 0,
    actual:
      failedTools.length === 0
        ? "clean"
        : failedTools.map((c) => c.capability).join(", "),
  });
  checks.push({
    label: `Route ∈ ${expect.routes.join(" | ")}`,
    pass: turn.route !== null && expect.routes.includes(turn.route),
    actual: turn.route ?? "UNCLASSIFIED",
  });
  for (const tool of expect.tools ?? []) {
    checks.push({
      label: `Calls ${tool}`,
      pass: tools.has(tool),
      actual: list(tools),
    });
  }
  if (expect.anyTools?.length) {
    checks.push({
      label: `Calls one of ${expect.anyTools.join(", ")}`,
      pass: expect.anyTools.some((tool) => tools.has(tool)),
      actual: list(tools),
    });
  }
  if (expect.forbiddenTools?.length) {
    const violated = expect.forbiddenTools.filter((tool) => tools.has(tool));
    checks.push({
      label: `Never calls ${expect.forbiddenTools.join(", ")}`,
      pass: violated.length === 0,
      actual: violated.length > 0 ? `called ${list(violated)}` : "clean",
    });
  }
  if (expect.minDelegations !== undefined) {
    // A READY task becomes an approval instead of a delegation; both count
    // as work the turn set in motion.
    const touched = new Set([
      ...turn.delegations.map((d) => d.taskId ?? d.jobId ?? d.id),
      ...turn.decisions.map((d) => d.resultingEntityId ?? d.id),
    ]).size;
    checks.push({
      label: `≥ ${expect.minDelegations} tasks/jobs touched`,
      pass: touched >= expect.minDelegations,
      actual: String(touched),
    });
  }
  if (expect.noDelegations) {
    checks.push({
      label: "Nothing delegated",
      pass: turn.delegations.length === 0,
      actual: `${turn.delegations.length} delegation(s)`,
    });
  }
  if (expect.asksQuestion) {
    checks.push({
      label: "Asks a question",
      pass: answer.includes("?"),
      actual: answer ? `${answer.slice(0, 80)}…` : "no answer",
    });
  }
  if (expect.noEmptyPromise) {
    const promised = EMPTY_PROMISE.test(answer);
    const scheduled = tools.has("create_schedule");
    checks.push({
      label: "No follow-up promise without a schedule",
      pass: !promised || scheduled,
      actual: promised
        ? scheduled
          ? "promised and scheduled"
          : "promised, no schedule"
        : "no bare promise",
    });
  }

  if (expect.noInventedIds) {
    const known = JSON.stringify({
      results: turn.toolCalls.map((call) => call.result),
      delegations: turn.delegations,
      decisions: turn.decisions,
    }).toLowerCase();
    const mentioned = Array.from(
      new Set((answer.match(UUID) ?? []).map((id) => id.toLowerCase())),
    );
    const invented = mentioned.filter((id) => !known.includes(id));
    checks.push({
      label: "Only ids from tool results",
      pass: invented.length === 0,
      actual:
        invented.length > 0
          ? `invented ${list(invented)}`
          : mentioned.length > 0
            ? `${mentioned.length} id(s) verified`
            : "no ids mentioned",
    });
  }

  return {
    checks,
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
  };
}
