import { describe, expect, it } from "vitest";
import { socialSyncPollIntervalMs } from "./social-sync-poll";

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
        { sync: { status: "running" } },
      ]),
    ).toBe(10_000);
  });
});
