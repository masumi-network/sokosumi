import { describe, expect, it } from "vitest";

import { shouldConsumePendingCoworkerStream } from "../room-helpers";

describe("shouldConsumePendingCoworkerStream", () => {
  it("consumes a pending 1:1 draft", () => {
    expect(
      shouldConsumePendingCoworkerStream({
        isCoworkerStreamRoom: true,
        hasPendingMessage: true,
      }),
    ).toBe(true);
  });

  it("does not consume when there is no pending draft", () => {
    expect(
      shouldConsumePendingCoworkerStream({
        isCoworkerStreamRoom: true,
        hasPendingMessage: false,
      }),
    ).toBe(false);
  });
});
