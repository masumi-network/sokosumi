import { beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import {
  isTaskAssignedToSokoBot,
  refineTaskAssigneeXorConflict,
  requireTaskAssignableOrchestrator,
  resolveTaskAssigneeForWrite,
} from "@/helpers/task-assignee";

const coworkerFindFirstMock = vi.fn();
const sokoBotFindFirstMock = vi.fn();
const requireTaskAssignableCoworkerMock = vi.fn();

vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: (...args: unknown[]) =>
    requireTaskAssignableCoworkerMock(...args),
}));

const tx = {
  coworker: { findFirst: coworkerFindFirstMock },
  sokoBot: { findFirst: sokoBotFindFirstMock },
} as never;

describe("refineTaskAssigneeXorConflict", () => {
  it("rejects both assignee rails in one request", () => {
    const issues: Array<{ message: string; path: Array<string | number> }> = [];
    refineTaskAssigneeXorConflict(
      { assigneeId: "cow_1", assigneeOrchestratorId: "bot_1" },
      {
        addIssue: (issue) => issues.push(issue),
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("mutually exclusive");
  });
});

describe("resolveTaskAssigneeForWrite shadow remap", () => {
  beforeEach(() => {
    coworkerFindFirstMock.mockReset();
    requireTaskAssignableCoworkerMock.mockReset();
    sokoBotFindFirstMock.mockReset();
  });

  it("remaps owner shadow PA coworker to orchestrator assignee", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      sokoBotId: "01960001-0001-7001-8001-000000000001",
      sokoBot: {
        userId: "user_owner",
        workspaceId: "ws_1",
        archivedAt: null,
        deletedAt: null,
      },
    });
    sokoBotFindFirstMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000001",
      userId: "user_owner",
    });

    const result = await resolveTaskAssigneeForWrite(
      { assigneeId: "cow_shadow" },
      {
        workspaceId: "ws_1",
        assigner: { kind: "user", userId: "user_owner" },
      },
      tx,
    );

    expect(result).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "01960001-0001-7001-8001-000000000001",
    });
    expect(requireTaskAssignableCoworkerMock).not.toHaveBeenCalled();
  });
});

describe("requireTaskAssignableOrchestrator", () => {
  beforeEach(() => {
    sokoBotFindFirstMock.mockReset();
  });

  it("forbids non-owner from assigning owner PA", async () => {
    sokoBotFindFirstMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000001",
      userId: "user_owner",
    });

    await expect(
      requireTaskAssignableOrchestrator(
        "01960001-0001-7001-8001-000000000001",
        "ws_1",
        tx,
        {
          kind: "user",
          userId: "user_other",
        },
      ),
    ).rejects.toEqual(
      forbidden("Only the owner can assign work to this Soko Bot"),
    );
  });
});

describe("isTaskAssignedToSokoBot", () => {
  it("matches orchestrator-only assignee rail", () => {
    expect(
      isTaskAssignedToSokoBot(
        { assigneeOrchestratorId: "bot_1", assigneeId: null },
        { id: "bot_1", coworkerId: "cow_shadow" },
      ),
    ).toBe(true);
  });

  it("matches legacy shadow coworker assignee rail", () => {
    expect(
      isTaskAssignedToSokoBot(
        { assigneeOrchestratorId: null, assigneeId: "cow_shadow" },
        { id: "bot_1", coworkerId: "cow_shadow" },
      ),
    ).toBe(true);
  });
});
