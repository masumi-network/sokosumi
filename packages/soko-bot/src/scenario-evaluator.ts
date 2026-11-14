import { oneTimeTaskCheck } from "./scenario-schedule-check.js";
import type {
  ScenarioCheck,
  ScenarioResult,
  SokoBotLabTurn,
  SokoBotScenario,
} from "./scenario-types.js";

function calledTools(turn: SokoBotLabTurn): Set<string> {
  const names = new Set(turn.toolCalls.map((call) => call.capability));
  for (const event of turn.events) {
    if (event.type === "actions.requested" && event.toolName) {
      names.add(event.toolName);
    }
  }
  return names;
}

/** A question mark, or a plain request to confirm ("Please confirm if you want me to post this."). */
function asksOwner(answer: string): boolean {
  return /\?|please confirm|confirm (if|whether)|let me know|want me to|shall i|should i|\breply\s+[“"‘']?post it\b|\bask me again to post\b/i.test(
    answer,
  );
}

function list(values: Iterable<string>): string {
  const items = Array.from(values);
  return items.length > 0 ? items.join(", ") : "none";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const EMPTY_PROMISE =
  /\b(I(?:'ll| will) (?:check|follow up|remind|monitor|keep an eye)|will check back|check back later)\b/i;

/** Anything that changes state the owner would notice. */
const MUTATING_TOOLS = new Set([
  "create_task",
  "update_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
  "link_tasks",
  "hire_agent",
  "post_chat",
  "ask_coworker",
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "find_people",
  "enrich_contact",
  "create_project",
  "update_project",
  "upload_file",
  "run_integration_tool",
  "create_schedule",
  "update_schedule",
  "delete_schedule",
  "update_memory",
]);

export function evaluateScenario(
  scenario: SokoBotScenario,
  turn: SokoBotLabTurn,
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
  const failedTools = turn.toolCalls.filter(
    (call) =>
      call.status === "FAILED" &&
      !expect.allowFailedTools?.includes(call.capability),
  );
  checks.push({
    label: "No failed tool calls",
    pass: failedTools.length === 0,
    // A bare tool name under a "no failed calls" label reads as the answer to
    // the label rather than as the thing that broke. Say which verb applies.
    actual:
      failedTools.length === 0
        ? "clean"
        : `${list(failedTools.map((c) => c.capability))} failed`,
  });
  checks.push({
    label: `Route ∈ ${expect.routes.join(" | ")}`,
    pass: turn.route !== null && expect.routes.includes(turn.route),
    actual: turn.route ?? "UNCLASSIFIED",
  });
  // A failing "Calls X" used to print the whole tool list and leave the reader
  // to notice X was absent from it. Lead with the verdict; the list is the
  // evidence behind it, not the finding.
  for (const tool of expect.tools ?? []) {
    checks.push({
      label: `Calls ${tool}`,
      pass: tools.has(tool),
      actual: tools.has(tool) ? "called" : `never called — used ${list(tools)}`,
    });
  }
  if (expect.anyTools?.length) {
    const used = expect.anyTools.filter((tool) => tools.has(tool));
    checks.push({
      label: `Calls one of ${expect.anyTools.join(", ")}`,
      pass: used.length > 0,
      actual:
        used.length > 0
          ? `called ${list(used)}`
          : `none called — used ${list(tools)}`,
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
  // A READY task becomes an approval instead of a delegation; both count as
  // work the turn set in motion.
  const touchedIds = new Set(
    [
      ...turn.delegations.map((d) => d.taskId ?? d.jobId ?? d.id),
      ...turn.decisions.map((d) => d.resultingEntityId ?? d.id),
    ].filter((id): id is string => Boolean(id)),
  );
  if (expect.scheduleTargetsTouchedTask) {
    const scheduleResults = turn.toolCalls
      .filter(
        (call) =>
          call.capability === "create_schedule" ||
          call.capability === "update_schedule",
      )
      .map((call) => JSON.stringify(call.result ?? ""));
    // Bounded rather than a substring test: an id that merely appears inside
    // a longer one is a different task, and matching it would report the
    // wrong schedule as correct.
    const namesTouchedTask = (text: string, id: string) =>
      new RegExp(
        `(^|[^0-9a-z-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9a-z-]|$)`,
        "i",
      ).test(text);
    const hit = scheduleResults.find((text) =>
      Array.from(touchedIds).some((id) => namesTouchedTask(text, id)),
    );
    checks.push({
      label: "Schedule names a task from this turn",
      pass: Boolean(hit),
      actual:
        scheduleResults.length === 0
          ? "no schedule touched"
          : hit
            ? "names it"
            : "schedule points somewhere else",
    });
  }
  if (expect.oneTimeTaskCheck) {
    checks.push(oneTimeTaskCheck(turn, expect.oneTimeTaskCheck));
  }
  if (expect.minDelegations !== undefined) {
    const touched = touchedIds.size;
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
      pass: asksOwner(answer),
      actual: answer ? `${answer.slice(0, 80)}…` : "no answer",
    });
  }
  if (expect.respondsToCoworker) {
    const replied = tools.has("reply_to_task");
    const asked = asksOwner(answer);
    checks.push({
      label: "Answers the Coworker or asks the owner",
      pass: replied || asked,
      actual: replied
        ? "replied on the task"
        : asked
          ? "asked the owner"
          : "neither",
    });
  }
  if (expect.answerMatches) {
    const re = new RegExp(expect.answerMatches, "i");
    checks.push({
      label: `Answer matches /${expect.answerMatches}/`,
      pass: re.test(answer.trim()),
      actual: answer.trim().slice(0, 80) || "(empty)",
    });
  }
  if (expect.answerAvoids) {
    const match = answer.match(new RegExp(expect.answerAvoids, "i"));
    checks.push({
      label: `Answer avoids /${expect.answerAvoids}/`,
      pass: !match,
      actual: match ? match[0] : "absent",
    });
  }
  if (expect.staysSilent) {
    const mutating = [...tools].filter((tool) => MUTATING_TOOLS.has(tool));
    checks.push({
      label: "Changes nothing",
      pass: mutating.length === 0 && turn.delegations.length === 0,
      actual:
        mutating.length > 0
          ? `called ${list(mutating)}`
          : turn.delegations.length > 0
            ? `${turn.delegations.length} delegation(s)`
            : "nothing changed",
    });
    const brief = answer.trim().length <= 200;
    checks.push({
      label: "Says so briefly",
      pass: brief,
      actual: `${answer.trim().length} chars`,
    });
  }
  if (expect.draftsOnly) {
    // Resuming a Coworker's own Task (reply_to_task READY) is follow-up,
    // not new work; only Tasks the bot created or assigned count.
    const ready = turn.delegations.filter(
      (d) =>
        d.action === "assign_task" ||
        ((d.action === "create_task" || d.action === "update_task") &&
          d.outcome === "READY"),
    );
    checks.push({
      label: "Created Tasks stay DRAFT",
      pass: ready.length === 0,
      actual:
        ready.length === 0
          ? "drafts only"
          : `${ready.length} set READY/assigned`,
    });
  }
  if (expect.attachesFollowUp) {
    const planned = turn.delegations.filter((d) => d.followUp);
    checks.push({
      label: "Delegated work carries a follow-up plan",
      pass: planned.length > 0,
      actual:
        planned.length > 0
          ? `${planned.length} plan(s)`
          : `${turn.delegations.length} delegation(s), no plan`,
    });
  }
  if (expect.noEmptyPromise) {
    const promised = EMPTY_PROMISE.test(answer);
    // Updating an existing schedule keeps the promise as well as creating one
    // does; counting only creation failed the bot for the tidier answer.
    const scheduled =
      tools.has("create_schedule") || tools.has("update_schedule");
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
      prompt: turn.userMessage ?? "",
      packet: turn.contextPacket ?? null,
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
