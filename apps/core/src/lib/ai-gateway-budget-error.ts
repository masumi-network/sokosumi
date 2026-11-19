export const GATEWAY_INTERNAL_SERVER_ERROR = "GatewayInternalServerError";

export function aiGatewayBudgetScope(message: unknown) {
  if (typeof message !== "string") return undefined;
  if (/^\s*API key budget exceeded\b/i.test(message)) return "key";
  if (/^\s*Team budget exceeded\b/i.test(message)) return "team";
}
