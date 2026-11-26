/**
 * Roles of the calls `soko_bot_model_call` records. No imports: the sandbox
 * runner tags its search calls with these and must not load Core's database.
 */
export type ModelCallRole =
  | "agent"
  | "classifier"
  | "judge"
  | "check"
  | "search"
  | "embedding";

/** `telemetry.functionId` of the calls that are not checks, by role. */
const FUNCTION_ROLES = {
  "soko-bot-agent": "agent",
  "cmo-month-writer": "agent",
  "cmo-strategy-step": "agent",
  "soko-bot-judge": "judge",
} as const satisfies Record<string, ModelCallRole>;

/** Tags a call for `telemetry`, so its record carries the right role. */
export function modelCallTelemetryFor(functionId: keyof typeof FUNCTION_ROLES) {
  return { functionId };
}

export function modelCallRoleOf(functionId: string | undefined): ModelCallRole {
  return functionId && Object.hasOwn(FUNCTION_ROLES, functionId)
    ? FUNCTION_ROLES[functionId as keyof typeof FUNCTION_ROLES]
    : "check";
}
