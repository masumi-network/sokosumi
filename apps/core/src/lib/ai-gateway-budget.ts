import { createHash } from "node:crypto";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { RetryError } from "ai";
import {
  aiGatewayBudgetScope,
  aiGatewayBudgetScopeFromBody,
  GATEWAY_INTERNAL_SERVER_ERROR,
} from "@/lib/ai-gateway-budget-error";
import {
  type AiGatewayPurpose,
  aiGatewayApiKey,
} from "@/lib/ai-gateway-purpose";
import { recordCoreError, recordCoreWarning } from "@/lib/evlog";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";

export const AI_BUDGET_EXCEEDED = CORE_API_ERROR_KINDS.AI_BUDGET_EXCEEDED;
export const AI_BUDGET_EXCEEDED_MESSAGE =
  "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.";
const ALERT_WINDOW_SECONDS = 60 * 60;
const localAlertExpiresAt = new Map<string, number>();

export class AiGatewayBudgetError extends Error {
  readonly code = AI_BUDGET_EXCEEDED;

  constructor() {
    super(AI_BUDGET_EXCEEDED_MESSAGE);
    this.name = "AiGatewayBudgetError";
  }
}

/** Use at the SDK call boundary, before applying a caller's failure policy. */
export async function rethrowAiGatewayFailure(
  error: unknown,
  purpose: AiGatewayPurpose = "default",
): Promise<never> {
  const failure = RetryError.isInstance(error) ? error.lastError : error;
  if (
    failure instanceof Error &&
    failure.name === GATEWAY_INTERNAL_SERVER_ERROR
  ) {
    const scope = aiGatewayBudgetScope(failure.message);
    if (scope) {
      await reportAiGatewayBudgetFailure(
        scope,
        purpose,
        aiGatewayApiKey(purpose),
      );
      throw new AiGatewayBudgetError();
    }
  }
  throw error;
}

/** A direct HTTP caller keeps its own fallback for other non-OK responses. */
export async function reportAiGatewayBudgetResponse(
  response: Response,
  apiKey: string | undefined,
): Promise<typeof AI_BUDGET_EXCEEDED | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return;
  }
  const scope = aiGatewayBudgetScopeFromBody(body);
  if (!scope) return;
  await reportAiGatewayBudgetFailure(scope, "default", apiKey);
  return AI_BUDGET_EXCEEDED;
}

export async function reportAiGatewayBudgetFailure(
  scope: "key" | "team",
  purpose: AiGatewayPurpose,
  apiKey: string | undefined,
): Promise<void> {
  const scopeId =
    scope === "team"
      ? scope
      : `key:${createHash("sha256")
          .update(apiKey ?? "oidc")
          .digest("hex")}`;
  const count = await incrementRedisRateLimit(
    `ai-gateway:budget-alert:${scopeId}`,
    ALERT_WINDOW_SECONDS,
  );
  const context = {
    operation: AI_BUDGET_EXCEEDED,
    aiGatewayBudget: { scope, purpose },
  };
  const diagnostic = {
    message: "AI Gateway budget exhausted",
    why: "The Gateway rejected a model call because its spend limit was reached.",
    fix: "Inspect the budget with vercel ai-gateway budgets.",
  };
  // Without a confirmed Redis claim, warn after the local scope is claimed so
  // Redis outages cannot cause an alert storm.
  const now = Date.now();
  const alert =
    count === 1 ||
    (count === undefined && (localAlertExpiresAt.get(scopeId) ?? 0) <= now);
  if (alert)
    localAlertExpiresAt.set(scopeId, now + ALERT_WINDOW_SECONDS * 1000);
  const report = alert ? recordCoreError : recordCoreWarning;
  report(context, diagnostic);
}
