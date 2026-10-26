import { beforeEach, describe, expect, it, vi } from "vitest";

const { askJevMock } = vi.hoisted(() => ({ askJevMock: vi.fn() }));
vi.mock("./jev", () => ({ askJev: askJevMock }));

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
    askJevMock.mockRejectedValue(new Error("timeout"));
    await expect(
      unattendedChaseRefusal({ turn: event, comment: chase, shared: false }),
    ).resolves.toBeNull();
  });

  it("points a shared bot at its room", async () => {
    askJevMock.mockResolvedValue(new Map([["chases", 0.9]]));
    await expect(
      unattendedChaseRefusal({ turn: event, comment: chase, shared: true }),
    ).resolves.toMatch(/the team in your shared room/);
  });
});
