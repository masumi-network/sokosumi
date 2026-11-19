import { createHash } from "node:crypto";
import type { AiGatewayPurpose } from "@/lib/ai-gateway-purpose";
import { recordCoreError, recordCoreWarning } from "@/lib/evlog";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";

export const AI_BUDGET_EXCEEDED = "ai_budget_exceeded";
export const AI_BUDGET_EXCEEDED_MESSAGE =
  "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.";
const ALERT_WINDOW_SECONDS = 60 * 60;
const localAlertExpiresAt = new Map<string, number>();

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
