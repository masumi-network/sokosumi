import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ default: { sokoBot: { findFirst } } }));

import { sokoBotForTurnMember } from "./soko-bot-turn-authority";
import { sokoBotWorkspaceAccessWhere } from "./soko-bot-workspace-access";

const MEMBER = { sokoBotId: "bot_1", userId: "member", workspaceId: "ws_1" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot_1",
    userId: "member",
    workspaceId: "ws_1",
    archivedAt: null,
    adminPausedAt: null,
    status: "RUNNING",
    workspace: { organizationId: "org_1" },
    ...overrides,
  };
}

beforeEach(() => {
  findFirst.mockReset();
});

describe("sokoBotForTurnMember", () => {
  it("asks for the turn's bot in the turn's workspace, as the turn's member", async () => {
    findFirst.mockResolvedValue(row());
    await sokoBotForTurnMember(MEMBER, "running");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "bot_1",
          workspaceId: "ws_1",
          deletedAt: null,
          workspace: sokoBotWorkspaceAccessWhere("member", "ws_1"),
        },
      }),
    );
  });

  it("returns the member's own personal bot", async () => {
    findFirst.mockResolvedValue(row());
    expect(await sokoBotForTurnMember(MEMBER, "running")).toMatchObject({
      id: "bot_1",
      userId: "member",
    });
  });

  it("refuses another user's personal bot", async () => {
    findFirst.mockResolvedValue(row({ userId: "someone-else" }));
    expect(await sokoBotForTurnMember(MEMBER, "running")).toBeNull();
  });

  it("returns a shared bot in an Organization workspace", async () => {
    findFirst.mockResolvedValue(row({ userId: null }));
    expect(await sokoBotForTurnMember(MEMBER, "running")).toMatchObject({
      id: "bot_1",
      userId: null,
    });
  });

  it("refuses a shared bot outside an Organization workspace", async () => {
    findFirst.mockResolvedValue(
      row({ userId: null, workspace: { organizationId: null } }),
    );
    expect(await sokoBotForTurnMember(MEMBER, "running")).toBeNull();
  });

  it("refuses when the member no longer reaches the workspace", async () => {
    findFirst.mockResolvedValue(null);
    expect(await sokoBotForTurnMember(MEMBER, "notArchived")).toBeNull();
  });

  it("uses the client it is given", async () => {
    const txFindFirst = vi.fn().mockResolvedValue(row());
    const tx = { sokoBot: { findFirst: txFindFirst } };
    expect(
      await sokoBotForTurnMember(MEMBER, "running", tx as never),
    ).not.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["notArchived", { archivedAt: new Date() }, false],
    ["notArchived", { status: "PAUSED" }, true],
    ["running", { status: "PAUSED" }, false],
    ["running", { adminPausedAt: new Date() }, true],
    ["runningNotAdminPaused", { adminPausedAt: new Date() }, false],
    ["runningNotAdminPaused", { archivedAt: new Date() }, false],
    ["runningNotAdminPaused", {}, true],
  ] as const)("%s with %o reaches the bot: %s", async (liveness, state, ok) => {
    findFirst.mockResolvedValue(row(state));
    const bot = await sokoBotForTurnMember(MEMBER, liveness);
    expect(bot !== null).toBe(ok);
  });
});
