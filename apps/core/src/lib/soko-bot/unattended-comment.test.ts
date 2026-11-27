import { beforeEach, describe, expect, it, vi } from "vitest";

const { askJevMock } = vi.hoisted(() => ({ askJevMock: vi.fn() }));
vi.mock("./jev", () => ({ askJev: askJevMock }));

import { expectCoreLogWhys } from "@/test/core-log";
import { unattendedChaseRefusal } from "./unattended-comment";

const event = { source: "EVENT", chainDepth: 0 };
const chase =
  "Please confirm whether implementation has started and share the next milestone.";

describe("unattendedChaseRefusal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("holds back a progress request in a turn nobody asked for", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.93]]));
    await expect(
      unattendedChaseRefusal({ turn: event, comment: chase, shared: false }),
    ).resolves.toMatch(/tell your owner what changed/);
  });

  it("posts a comment that brings the Task something", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.12]]));
    await expect(
      unattendedChaseRefusal({
        turn: event,
        comment: "The Base RPC key is in the shared vault under x402.",
        shared: false,
      }),
    ).resolves.toBeNull();
  });

  it("leaves the owner's own chat requests alone without asking Jev", async () => {
    await expect(
      unattendedChaseRefusal({
        turn: { source: "CHAT", chainDepth: 0 },
        comment: chase,
        shared: false,
      }),
    ).resolves.toBeNull();
    expect(askJevMock).not.toHaveBeenCalled();
  });

  it("lets the comment through when the check fails", async () => {
    expectCoreLogWhys(
      "warn",
      "Could not check whether a Soko Bot comment chases people",
      ["Jev, the judging model, failed or timed out"],
    );
    askJevMock.mockRejectedValue(new Error("timeout"));
    await expect(
      unattendedChaseRefusal({ turn: event, comment: chase, shared: false }),
    ).resolves.toBeNull();
  });

  it("on a Task its Coworker turned down, points at the owner's options instead", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.9]]));
    const refusal = await unattendedChaseRefusal({
      turn: event,
      comment: "Please resume this same task when available.",
      shared: false,
      declined: async () => true,
    });
    expect(refusal).toMatch(/this Task is FAILED/);
    expect(refusal).toMatch(/another Coworker \(find_coworkers\)/);
    expect(refusal).toMatch(/create_schedule with runAt/);
    expect(refusal).not.toMatch(/status update/);
  });

  it("keeps the chase refusal when the Task was not turned down", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.9]]));
    await expect(
      unattendedChaseRefusal({
        turn: event,
        comment: chase,
        shared: false,
        declined: async () => false,
      }),
    ).resolves.toMatch(/chases people for a status update/);
  });

  it("asks whether the Task was turned down only when it holds a comment back", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.1]]));
    const declined = vi.fn(async () => true);
    await expect(
      unattendedChaseRefusal({
        turn: event,
        comment: "The key is in the vault.",
        shared: false,
        declined,
      }),
    ).resolves.toBeNull();
    expect(declined).not.toHaveBeenCalled();
  });

  it("points a shared bot at its room", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.9]]));
    await expect(
      unattendedChaseRefusal({ turn: event, comment: chase, shared: true }),
    ).resolves.toMatch(/the team in your shared room/);
  });
});
