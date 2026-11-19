import { createHash } from "node:crypto";
import type { AiGatewayPurpose } from "@/lib/ai-gateway-purpose";
import { recordCoreError, recordCoreWarning } from "@/lib/evlog";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";

export const AI_BUDGET_EXCEEDED = "ai_budget_exceeded";
export const AI_BUDGET_EXCEEDED_MESSAGE =
  "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.";
export const GATEWAY_INTERNAL_SERVER_ERROR = "GatewayInternalServerError";

export function aiGatewayBudgetScope(message: unknown) {
  if (typeof message !== "string") return undefined;
  if (/^\s*API key budget exceeded\b/i.test(message)) return "key";
  if (/^\s*Team budget exceeded\b/i.test(message)) return "team";
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
    60 * 60,
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
  // Without a confirmed claim, warn so Redis outages cannot cause an alert storm.
  const report = count === 1 ? recordCoreError : recordCoreWarning;
  report(context, diagnostic);
}
