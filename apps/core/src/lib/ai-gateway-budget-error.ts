export const GATEWAY_INTERNAL_SERVER_ERROR = "GatewayInternalServerError";

export function aiGatewayBudgetScope(message: unknown) {
  if (typeof message !== "string") return undefined;
  if (/^\s*API key budget exceeded\b/i.test(message)) return "key";
  if (/^\s*Team budget exceeded\b/i.test(message)) return "team";
}

export function aiGatewayBudgetScopeFromBody(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) return;
  const error = body.error;
  if (!error || typeof error !== "object" || !("type" in error)) return;
  if (
    (error.type === "internal_server_error" ||
      error.type === "quota_for_entity_exceeded") &&
    "message" in error
  ) {
    return aiGatewayBudgetScope(error.message);
  }
}
