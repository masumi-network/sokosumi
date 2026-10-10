import { describe, expect, it } from "vitest";
import { publishFailureCopy } from "./social-post-publish-failure";

const COPY: Record<string, string> = {
  "outcomes.authorizationRevoked": "Coworker access revoked.",
  "outcomes.connectionInactive": "Account disconnected. Reconnect to retry.",
  "outcomes.missed": "Missed the scheduled time.",
  "failures.rateLimited": "Rate limited. Try again later.",
  "failures.timeout": "Timed out. Try again.",
  "failures.unauthorized": "Reconnect the account.",
  "failures.unavailable": "The platform is down. Try again later.",
  "failures.rejected": "The platform rejected this post.",
  "failures.mediaMissing": "A file is missing.",
  "failures.mediaType": "That file type is not allowed.",
};

function t(key: string): string {
  return COPY[key] ?? key;
}

function post(partial: {
  status?: "FAILED" | "MISSED";
  lastError?: string | null;
  outcome?:
    | "failed_permanent"
    | "failed_transient"
    | "missed"
    | "connection_inactive"
    | "authorization_revoked"
    | null;
  errorKind?: string | null;
}) {
  return {
    status: partial.status ?? "FAILED",
    lastError: partial.lastError ?? "X rejected the post (403 forbidden)",
    lastAttempt: {
      attempt: 1,
      trigger: "publish_now" as const,
      outcome: partial.outcome ?? "failed_permanent",
      errorKind: partial.errorKind ?? null,
      providerOutcome: null,
      finishedAt: new Date("2026-09-10T10:05:00.000Z"),
    },
  };
}

describe("publishFailureCopy", () => {
  it.each([
    ["authorization_revoked", "Coworker access revoked."],
    ["connection_inactive", "Account disconnected. Reconnect to retry."],
    ["missed", "Missed the scheduled time."],
  ] as const)("maps outcome %s", (outcome, copy) => {
    expect(
      publishFailureCopy(
        post({
          status: outcome === "missed" ? "MISSED" : "FAILED",
          outcome,
          lastError: "raw provider text",
        }),
        t,
      ),
    ).toBe(copy);
  });

  it.each([
    ["rate_limited", "Rate limited. Try again later."],
    ["timeout", "Timed out. Try again."],
    ["unauthorized", "Reconnect the account."],
    ["provider_unavailable", "The platform is down. Try again later."],
    ["rejected", "The platform rejected this post."],
    ["provider_rejected", "The platform rejected this post."],
    ["media_missing", "A file is missing."],
    ["media_type_mismatch", "That file type is not allowed."],
  ] as const)("maps errorKind %s", (errorKind, copy) => {
    expect(
      publishFailureCopy(
        post({ errorKind, lastError: "raw provider text" }),
        t,
      ),
    ).toBe(copy);
  });

  it("keeps lastError when the kind is unknown", () => {
    expect(
      publishFailureCopy(
        post({
          errorKind: "unknown",
          lastError: "Unexpected error while publishing",
        }),
        t,
      ),
    ).toBe("Unexpected error while publishing");
  });
});
