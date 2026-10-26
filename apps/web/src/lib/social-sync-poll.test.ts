import { SOCIAL_SYNC_LEASE_MS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  isSocialSyncInFlight,
  socialSyncPollIntervalMs,
} from "./social-sync-poll";

describe("socialSyncPollIntervalMs", () => {
  it("polls only while an account is queued or running", () => {
    expect(socialSyncPollIntervalMs([])).toBe(false);
    expect(socialSyncPollIntervalMs([{ sync: { status: "fresh" } }])).toBe(
      false,
    );
    expect(socialSyncPollIntervalMs([{ sync: { status: "queued" } }])).toBe(
      10_000,
    );
    expect(
      socialSyncPollIntervalMs([
        { sync: { status: "fresh" } },
        {
          sync: { status: "running" },
          statistics: { refreshAttemptedAt: new Date() },
        },
      ]),
    ).toBe(10_000);
  });

  it("expires a running attempt at the same lease boundary as Core", () => {
    const now = Date.parse("2026-10-14T08:00:00Z");
    const account = {
      sync: { status: "running" },
      statistics: { refreshAttemptedAt: new Date(now - SOCIAL_SYNC_LEASE_MS) },
    };
    expect(isSocialSyncInFlight(account, now - 1)).toBe(true);
    expect(isSocialSyncInFlight(account, now)).toBe(false);
    expect(isSocialSyncInFlight(account, now + 1)).toBe(false);
  });

  it.each([undefined, null, "bad date"])(
    "stops polling when running has no usable attempt: %s",
    (refreshAttemptedAt) => {
      expect(
        socialSyncPollIntervalMs([
          { sync: { status: "running" }, statistics: { refreshAttemptedAt } },
        ]),
      ).toBe(false);
    },
  );

  it("uses the live attempt in Core's sync version while the previous snapshot is retained", () => {
    const now = Date.parse("2026-10-14T08:00:00Z");
    const account = {
      sync: {
        status: "running",
        dataVersion:
          "2026-10-08T08:00:00Z|2026-10-08T08:00:00Z||2026-10-14T08:00:00Z",
      },
      statistics: { refreshAttemptedAt: "2026-10-08T08:00:00Z" },
    };
    expect(isSocialSyncInFlight(account, now)).toBe(true);
    expect(isSocialSyncInFlight(account, now + SOCIAL_SYNC_LEASE_MS)).toBe(
      false,
    );
  });
});
