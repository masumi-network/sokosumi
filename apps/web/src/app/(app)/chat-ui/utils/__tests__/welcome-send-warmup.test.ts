import { describe, expect, it } from "vitest";

import { isCoworkerWarmupReadyForWelcomeSend } from "../welcome-send-warmup";

describe("isCoworkerWarmupReadyForWelcomeSend", () => {
  it("blocks while warmup is unset or still pending", () => {
    expect(
      isCoworkerWarmupReadyForWelcomeSend({
        warmupState: null,
        warmupFailed: false,
      }),
    ).toBe(false);
    expect(
      isCoworkerWarmupReadyForWelcomeSend({
        warmupState: "pending",
        warmupFailed: false,
      }),
    ).toBe(false);
  });

  it("allows send after warmup reaches ready or failed", () => {
    expect(
      isCoworkerWarmupReadyForWelcomeSend({
        warmupState: "ready",
        warmupFailed: false,
      }),
    ).toBe(true);
    expect(
      isCoworkerWarmupReadyForWelcomeSend({
        warmupState: "failed",
        warmupFailed: false,
      }),
    ).toBe(true);
  });

  it("allows send when warmup polling timed out", () => {
    expect(
      isCoworkerWarmupReadyForWelcomeSend({
        warmupState: null,
        warmupFailed: true,
      }),
    ).toBe(true);
  });
});
