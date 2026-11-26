import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { syncStatisticsBodySchema, syncStatisticsValidationHook } from "./sync";

function refusal(body: unknown): string {
  const result = syncStatisticsBodySchema.safeParse(body);
  try {
    syncStatisticsValidationHook(result);
  } catch (error) {
    if (error instanceof HTTPException && error.status === 422)
      return error.message;
    throw error;
  }
  throw new Error("expected a 422");
}

// SOKD-482: both branches failed, and the 422 said only "Invalid input".
describe("SEO statistics sync body", () => {
  it("names every field a provider sync is missing", () => {
    expect(refusal({ provider: "search_console" })).toBe(
      "Key: propertyId - Invalid input: expected string, received undefined. Also check: from, to.",
    );
  });

  it("starts from the provider for an empty body", () => {
    expect(refusal({})).toMatch(
      /^Key: provider - .*Also check: propertyId, from, to\.$/,
    );
  });

  it("follows the audit branch when auditTaskId is sent", () => {
    expect(refusal({ auditTaskId: "not-a-uuid" })).toBe(
      "Key: auditTaskId - Invalid UUID",
    );
  });

  it("passes a complete body", () => {
    const result = syncStatisticsBodySchema.safeParse({
      provider: "search_console",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(result.success).toBe(true);
    expect(syncStatisticsValidationHook(result)).toBeUndefined();
  });
});
