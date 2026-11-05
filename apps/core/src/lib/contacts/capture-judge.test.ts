import { beforeEach, describe, expect, it, vi } from "vitest";

const { askJev } = vi.hoisted(() => ({ askJev: vi.fn() }));
vi.mock("@/lib/soko-bot/jev", () => ({ askJev }));

import { judgeRoleInboxes, MIN_PERSON_PROBABILITY } from "./capture-judge";

const samples = [
  {
    email: "hello@founder.dev",
    name: "Sam Founder",
    topic: "Intro",
    direction: "OUT" as const,
  },
  {
    email: "support@vendor.io",
    name: null,
    topic: "Invoice",
    direction: "OUT" as const,
  },
];

beforeEach(() => askJev.mockReset());

describe("judgeRoleInboxes", () => {
  it("asks one question per address and returns the probabilities in order", async () => {
    askJev.mockResolvedValue(
      new Map([
        ["address0", 0.9],
        ["address1", 0.1],
      ]),
    );
    const ratings = await judgeRoleInboxes(samples);
    expect(ratings).toEqual([0.9, 0.1]);
    expect(ratings?.map((r) => r >= MIN_PERSON_PROBABILITY)).toEqual([
      true,
      false,
    ]);
    const call = askJev.mock.calls[0]?.[0];
    expect(Object.keys(call.questions)).toEqual(["address0", "address1"]);
    expect(call.questions.address0).toMatch(/untrusted/);
    expect(call.state.addresses[0]).toMatchObject({
      key: "address0",
      email: "hello@founder.dev",
    });
  });

  it("counts a missing answer as no", async () => {
    askJev.mockResolvedValue(new Map([["address0", 0.8]]));
    expect(await judgeRoleInboxes(samples)).toEqual([0.8, 0]);
  });

  it("returns null when Jev fails, and asks nothing for nothing", async () => {
    askJev.mockRejectedValue(new Error("timeout"));
    expect(await judgeRoleInboxes(samples)).toBeNull();
    askJev.mockReset();
    expect(await judgeRoleInboxes([])).toEqual([]);
    expect(askJev).not.toHaveBeenCalled();
  });
});
