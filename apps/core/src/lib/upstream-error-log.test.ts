import { describe, expect, it } from "vitest";
import { REDACTED_SECRET } from "./secret-redaction.js";
import {
  formatUpstreamErrorForLog,
  MAX_UPSTREAM_ERROR_LOG_LENGTH,
} from "./upstream-error-log.js";

// GOOGLE_CLIENT_SECRET from src/test/setup.ts.
const SECRET = "test-google-client-secret";

describe("formatUpstreamErrorForLog", () => {
  it("preserves short messages", () => {
    expect(formatUpstreamErrorForLog("payment rejected")).toBe(
      "payment rejected",
    );
  });

  it("redacts before truncating a credential that crosses the boundary", () => {
    const message =
      "x".repeat(MAX_UPSTREAM_ERROR_LOG_LENGTH - SECRET.length) +
      SECRET +
      "x".repeat(20_000);
    const logged = formatUpstreamErrorForLog(message);
    expect(logged).toHaveLength(MAX_UPSTREAM_ERROR_LOG_LENGTH);
    expect(logged).not.toContain(SECRET.slice(0, 10));
    expect(logged).toContain("[redacted:");
    expect(logged).toContain("[truncated]");
  });

  it("redacts complete credentials in short messages", () => {
    expect(formatUpstreamErrorForLog(`token=${SECRET}`)).toBe(
      `token=${REDACTED_SECRET}`,
    );
  });
});
