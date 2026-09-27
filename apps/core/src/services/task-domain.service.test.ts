import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { createTaskForActor } from "./task-domain.service";

describe("createTaskForActor", () => {
  it("rejects a human assignee on a private Task", async () => {
    const taskCreateMock = vi.fn();
    const tx = { task: { create: taskCreateMock } } as never;

    await expect(
      createTaskForActor(
        {
          actor: { kind: "user", userId: "user_123" },
          ownerId: "user_123",
          organizationId: "org_123",
          workspaceId: "workspace_123",
          name: "Secret",
          status: TaskStatus.DRAFT,
          visibility: "PRIVATE",
          assigneeUserId: "user_teammate",
        },
        tx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Private Tasks cannot be assigned to a human teammate",
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });
});
