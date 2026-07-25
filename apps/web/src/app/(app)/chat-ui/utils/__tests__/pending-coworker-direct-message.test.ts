import { describe, expect, it } from "vitest";

import {
  isPendingCoworkerDirectMessageFresh,
  type PendingCoworkerDirectMessage,
  pendingCoworkerDirectMessageMatchesBucket,
} from "../pending-coworker-direct-message";

function pendingMessage(
  overrides: Partial<PendingCoworkerDirectMessage> = {},
): PendingCoworkerDirectMessage {
  return {
    coworkerId: "7f5de96e-245f-4f4a-8566-cad4e4f64a48",
    coworkerSlug: "Hannah",
    content: "please help",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("pending coworker direct message", () => {
  it("treats recent handoffs as fresh", () => {
    expect(
      isPendingCoworkerDirectMessageFresh(pendingMessage(), 1_000 + 30_000),
    ).toBe(true);
  });

  it("expires old handoffs", () => {
    expect(
      isPendingCoworkerDirectMessageFresh(pendingMessage(), 1_000 + 130_000),
    ).toBe(false);
  });

  it("matches the visible chat bucket slug case-insensitively", () => {
    expect(
      pendingCoworkerDirectMessageMatchesBucket(pendingMessage(), {
        bucketSlug: "hannah",
      }),
    ).toBe(true);
  });

  it("matches bucket key by coworker id when no slug exists", () => {
    expect(
      pendingCoworkerDirectMessageMatchesBucket(
        pendingMessage({
          coworkerSlug: "7f5de96e-245f-4f4a-8566-cad4e4f64a48",
        }),
        {
          bucketKey: "coworker:7f5de96e-245f-4f4a-8566-cad4e4f64a48",
          bucketSlug: "hannah",
        },
      ),
    ).toBe(true);
  });
});
