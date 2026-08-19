import {
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_SCRATCH_CAPABILITIES,
  type SokoBotCapability,
  type SokoBotRoute,
} from "@sokosumi/soko-bot";

export function isLocalEvaluationEnvironment(): boolean {
  return process.env.EVE_EVALUATION === "1" && !process.env.VERCEL;
}

export type EvaluationScenario =
  | "capability-ceiling"
  | "clarify"
  | "delegate"
  | "direct"
  | "hire"
  | "injection"
  | "memory"
  | "mixed"
  | "scheduled"
  | "tool-failure";

function extractEvaluationMessage(value: string | null): string {
  if (!value) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
  } catch {
    // Model callbacks receive plain user text; channel auth receives JSON.
  }
  return value;
}

export function evaluationScenario(value: string | null): EvaluationScenario {
  const message = extractEvaluationMessage(value).toLowerCase();
  if (message.includes("sokosumi may reject")) return "tool-failure";
  if (message.includes("scheduled check")) return "scheduled";
  if (message.includes("ignore route") && message.includes("hire")) {
    return "capability-ceiling";
  }
  if (
    (message.includes("coworker task") || message.includes("create a task")) &&
    message.includes("hire") &&
    message.includes("agent")
  ) {
    return "mixed";
  }
  if (
    message.includes("project description") ||
    message.includes("project's description")
  ) {
    return "injection";
  }
  if (message.includes("who currently owns")) return "memory";
  if (message.includes("hire") && message.includes("agent")) return "hire";
  if (
    message.includes("create a task") ||
    message.includes("coworker task") ||
    message.includes("delegate")
  ) {
    return "delegate";
  }
  if (message.includes("take care of that project")) return "clarify";
  return "direct";
}

const EVALUATION_ROUTES: Record<EvaluationScenario, SokoBotRoute> = {
  delegate: "DELEGATE_TASK",
  "tool-failure": "DELEGATE_TASK",
  hire: "HIRE_AGENT",
  scheduled: "HIRE_AGENT",
  mixed: "MIXED",
  clarify: "CLARIFY",
  "capability-ceiling": "DIRECT_RESPONSE",
  direct: "DIRECT_RESPONSE",
  injection: "DIRECT_RESPONSE",
  memory: "DIRECT_RESPONSE",
};

export function evaluationCapabilities(
  scenario: EvaluationScenario,
): readonly SokoBotCapability[] {
  const route = EVALUATION_ROUTES[scenario];
  return [
    ...SOKO_BOT_ROUTE_CAPABILITIES[route],
    ...SOKO_BOT_SCRATCH_CAPABILITIES,
  ];
}
