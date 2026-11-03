import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ evaluate: vi.fn() }));
vi.mock("./jev", () => ({ evaluateWithJev: mocks.evaluate }));

import {
  mailSendRefusal,
  ownerAskedToSend,
  ownerConfirmedConsent,
} from "./mail-send-guard";

const ownerChat = {
  source: "CHAT",
  chainDepth: 0,
  askedByAssistant: false,
  shared: false,
};
const draft = { to: ["anna@acme.com"], subject: "Offer" };

function jevSays(probability: number) {
  mocks.evaluate.mockResolvedValue({
    answers: new Map([["said", { type: "boolean", probability }]]),
    costUsd: 0,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("mailSendRefusal", () => {
  it("allows the owner's own chat", () => {
    expect(mailSendRefusal(ownerChat)).toBeNull();
  });

  it.each([
    { ...ownerChat, source: "SCHEDULE" },
    { ...ownerChat, chainDepth: 1 },
    { ...ownerChat, askedByAssistant: true },
    { ...ownerChat, shared: true },
  ])("refuses %o", (turn) => {
    expect(mailSendRefusal(turn)).not.toBeNull();
  });
});

describe("ownerAskedToSend", () => {
  it("sends on a clear instruction", async () => {
    jevSays(0.95);
    await expect(ownerAskedToSend("yes, send it", draft)).resolves.toBe(true);
  });

  it("does not send below the threshold", async () => {
    jevSays(0.6);
    await expect(ownerAskedToSend("looks good?", draft)).resolves.toBe(false);
  });

  it("fails closed when Jev is down or there is no message", async () => {
    mocks.evaluate.mockRejectedValue(new Error("timeout"));
    await expect(ownerAskedToSend("send it", draft)).resolves.toBe(false);
    await expect(ownerAskedToSend(null, draft)).resolves.toBe(false);
  });
});

describe("ownerConfirmedConsent", () => {
  it("confirms when the owner says the people agreed", async () => {
    jevSays(0.9);
    await expect(
      ownerConfirmedConsent("They all opted in at the fair", "ada@example.com"),
    ).resolves.toBe(true);
    expect(mocks.evaluate.mock.calls[0]?.[0].state).toEqual({
      ownerMessage: "They all opted in at the fair",
      people: "ada@example.com",
    });
  });

  it("fails closed below the threshold, on errors and without a message", async () => {
    jevSays(0.7);
    await expect(
      ownerConfirmedConsent("add them", "ada@example.com"),
    ).resolves.toBe(false);
    mocks.evaluate.mockRejectedValue(new Error("timeout"));
    await expect(
      ownerConfirmedConsent("they agreed", "ada@example.com"),
    ).resolves.toBe(false);
    await expect(ownerConfirmedConsent(" ", "ada@example.com")).resolves.toBe(
      false,
    );
  });
});
