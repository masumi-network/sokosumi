import { TaskVisibility } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireTaskAssignableSokoBot } from "./soko-bot-task-assign";

const { botFindFirstMock } = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findFirst: botFindFirstMock } },
}));

const WORKSPACE_ID = "workspace_1";
const MEMBER = { kind: "user", userId: "member_1" } as const;
const PUBLIC_IN_PROJECT = {
  visibility: TaskVisibility.PUBLIC,
  projectId: "project_1",
};

function assign(
  task?: { visibility: TaskVisibility; projectId: string | null },
  assigner: Parameters<typeof requireTaskAssignableSokoBot>[3] = MEMBER,
) {
  return requireTaskAssignableSokoBot(
    "bot_1",
    WORKSPACE_ID,
    undefined,
    assigner,
    task,
  );
}

describe("requireTaskAssignableSokoBot for a shared bot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindFirstMock.mockResolvedValue({
      id: "bot_1",
      userId: null,
      projectId: "project_1",
    });
  });

  it("lets a member hand a project bot a public Task of its Project", async () => {
    await expect(assign(PUBLIC_IN_PROJECT)).resolves.toBeUndefined();
  });

  it("lets a member hand a workspace bot a public Task of any Project", async () => {
    botFindFirstMock.mockResolvedValue({
      id: "bot_1",
      userId: null,
      projectId: null,
    });

    await expect(
      assign({ visibility: TaskVisibility.PUBLIC, projectId: "project_2" }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["a private Task", { ...PUBLIC_IN_PROJECT, visibility: "PRIVATE" }],
    ["a Task of another Project", { ...PUBLIC_IN_PROJECT, projectId: "p2" }],
    ["a Task with no Project", { ...PUBLIC_IN_PROJECT, projectId: null }],
  ] as const)("refuses %s for a project bot", async (_label, task) => {
    await expect(assign(task)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a caller that cannot name the Task", async () => {
    await expect(assign(undefined)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a coworker assigner", async () => {
    await expect(
      assign(PUBLIC_IN_PROJECT, { kind: "other" }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("still lets the shared bot assign work to itself", async () => {
    await expect(
      assign(undefined, { kind: "soko_bot", sokoBotId: "bot_1" }),
    ).resolves.toBeUndefined();
  });

  it("keeps the owner rule for a personal bot whatever the Task", async () => {
    botFindFirstMock.mockResolvedValue({
      id: "bot_1",
      userId: "owner_1",
      projectId: null,
    });

    await expect(assign(PUBLIC_IN_PROJECT)).rejects.toThrow(
      "Only the owner can assign work to this Soko Bot",
    );
  });
});
