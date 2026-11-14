import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  requireAssigneeForExecutableStatus,
  requireAssigneeXor,
  taskAssigner,
} from "./task-domain-assignee-guards";

describe("Task assignee validation", () => {
  it("rejects multiple assignee kinds while allowing one or none", () => {
    expect(() => requireAssigneeXor("coworker", "bot", null)).toThrow(
      "more than one assignee",
    );
    expect(() => requireAssigneeXor(null, null, "member")).not.toThrow();
    expect(() => requireAssigneeXor(null, null, null)).not.toThrow();
  });

  it("requires an agent before a Task can be queued", () => {
    expect(() =>
      requireAssigneeForExecutableStatus(
        TaskStatus.QUEUED,
        null,
        null,
        "member",
      ),
    ).toThrow("agent");
    expect(() =>
      requireAssigneeForExecutableStatus(TaskStatus.DRAFT, null, null, null),
    ).not.toThrow();
    expect(() =>
      requireAssigneeForExecutableStatus(
        TaskStatus.READY,
        "coworker",
        null,
        null,
      ),
    ).not.toThrow();
  });

  it("never grants a Coworker the user's tasking authority", () => {
    expect(taskAssigner({ kind: "user", userId: "owner" })).toEqual({
      kind: "user",
      userId: "owner",
    });
    expect(taskAssigner({ kind: "soko_bot", sokoBotId: "bot" })).toEqual({
      kind: "soko_bot",
      sokoBotId: "bot",
    });
    expect(
      taskAssigner({
        kind: "coworker",
        coworkerId: "coworker",
        vendorId: "vendor",
        enforceWorkspaceGrant: true,
      }),
    ).toEqual({ kind: "other" });
  });
});
