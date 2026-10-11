import { describe, expect, it } from "vitest";
import { publishFailureCopy } from "./social-post-publish-failure";

const COPY: Record<string, string> = {
  "outcomes.authorizationRevoked":
    "Coworker scheduling access was revoked. Reschedule this post to publish it.",
  "outcomes.connectionInactive": "Account disconnected. Reconnect to retry.",
  "outcomes.missed": "Missed the scheduled time.",
  "failures.rateLimited": "Rate limited. Try again later.",
  "failures.timeout": "Timed out. Try again.",
  "failures.unauthorized": "Reconnect the account.",
  "failures.unavailable": "The platform is down. Try again later.",
  "failures.rejected": "The platform rejected this post.",
  "failures.mediaMissing": "A file is missing.",
  "failures.mediaType": "That file type is not allowed.",
  "failures.generic": "Couldn't publish. Open the post for details.",
};

function t(key: string): string {
  return COPY[key] ?? key;
}

function post(partial: {
  status?: "FAILED" | "MISSED";
  outcome?: string | null;
  errorKind?: string | null;
}) {
  return {
    status: partial.status ?? "FAILED",
    lastAttempt: {
      outcome: partial.outcome ?? "failed_permanent",
      errorKind: partial.errorKind ?? null,
    },
  };
}

describe("publishFailureCopy", () => {
  it.each([
    [
      "authorization_revoked",
      "Coworker scheduling access was revoked. Reschedule this post to publish it.",
    ],
    ["connection_inactive", "Account disconnected. Reconnect to retry."],
    ["missed", "Missed the scheduled time."],
  ] as const)("maps outcome %s", (outcome, copy) => {
    expect(
      publishFailureCopy(
        post({
          status: outcome === "missed" ? "MISSED" : "FAILED",
          outcome,
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
    expect(publishFailureCopy(post({ errorKind }), t)).toBe(copy);
  });

  it("never returns a raw provider error", () => {
    expect(
      publishFailureCopy(
        {
          status: "FAILED",
          lastAttempt: {
            outcome: "failed_permanent",
            errorKind: "unknown",
          },
        },
        t,
      ),
    ).toBe("Couldn't publish. Open the post for details.");
  });

  it("falls back when there is no attempt", () => {
    expect(publishFailureCopy({ status: "FAILED", lastAttempt: null }, t)).toBe(
      "Couldn't publish. Open the post for details.",
    );
  });
});
