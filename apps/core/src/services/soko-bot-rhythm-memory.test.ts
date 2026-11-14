import { expect, it, vi } from "vitest";

const { memory, tasks } = vi.hoisted(() => ({
  memory: vi.fn(),
  tasks: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotMemoryRevision: { findFirst: memory },
    task: { findMany: tasks },
  },
}));

import { memoryFollowUps } from "./soko-bot-rhythm-memory";

it("does not turn a teammate's remembered follow-up into the owner's work", async () => {
  const ownerTask = "01960001-0001-7001-8001-000000000001";
  const assignedTask = "01960001-0001-7001-8001-000000000002";
  const foreignTask = "01960001-0001-7001-8001-000000000003";
  const bot = {
    id: "bot",
    userId: "owner",
    workspaceId: "workspace",
    ingestTimezone: "UTC",
  };
  memory.mockResolvedValue({
    markdown: `# Soko Bot memory\n\n## Follow-ups\n- Owner's check-in (${ownerTask})\n- Assigned review (${assignedTask})\n- Teammate's check-in (${foreignTask})\n`,
  });
  tasks.mockResolvedValue(
    [
      { id: ownerTask, ownerId: "owner", assigneeSokoBotId: null },
      { id: assignedTask, ownerId: "teammate", assigneeSokoBotId: bot.id },
      { id: foreignTask, ownerId: "teammate", assigneeSokoBotId: null },
    ].map((task) => ({
      ...task,
      name: "Task",
      status: "RUNNING",
      archivedAt: null,
      owner: { name: task.ownerId },
    })),
  );

  expect(await memoryFollowUps(bot)).toEqual([
    `Owner's check-in (${ownerTask})`,
    `Assigned review (${assignedTask})`,
  ]);
});
