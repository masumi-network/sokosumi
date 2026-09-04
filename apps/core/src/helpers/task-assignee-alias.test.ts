import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  nextAssigneeWrite,
  refineAssigneeIdAliasConflict,
  refineAssigneeXorConflict,
  resolveAssigneeIdFromRequest,
} from "./task-assignee-alias";

describe("resolveAssigneeIdFromRequest", () => {
  it("prefers assigneeId when both are set", () => {
    expect(
      resolveAssigneeIdFromRequest({
        assigneeId: "cow_new",
        coworkerId: "cow_new",
      }),
    ).toBe("cow_new");
  });

  it("uses deprecated coworkerId when only coworkerId is set", () => {
    expect(
      resolveAssigneeIdFromRequest({
        coworkerId: "cow_legacy",
      }),
    ).toBe("cow_legacy");
  });

  it("returns undefined when neither field is provided", () => {
    expect(resolveAssigneeIdFromRequest({})).toBeUndefined();
  });

  it("preserves explicit null from assigneeId", () => {
    expect(
      resolveAssigneeIdFromRequest({
        assigneeId: null,
      }),
    ).toBeNull();
  });
});

describe("refineAssigneeIdAliasConflict", () => {
  const schema = z
    .object({
      assigneeId: z.string().nullish(),
      coworkerId: z.string().nullish(),
    })
    .superRefine(refineAssigneeIdAliasConflict);

  it("rejects conflicting assigneeId and coworkerId", () => {
    expect(() =>
      schema.parse({
        assigneeId: "cow_a",
        coworkerId: "cow_b",
      }),
    ).toThrow();
  });

  it("accepts matching assigneeId and coworkerId", () => {
    expect(
      schema.parse({
        assigneeId: "cow_a",
        coworkerId: "cow_a",
      }),
    ).toEqual({
      assigneeId: "cow_a",
      coworkerId: "cow_a",
    });
  });
});

describe("refineAssigneeXorConflict", () => {
  it("allows an empty coworker id with an orchestrator assignee", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeId: "", assigneeOrchestratorId: "bot-1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toEqual([]);
  });

  it("rejects two non-empty assignee identifiers", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeId: "cow_1", assigneeOrchestratorId: "bot-1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toEqual([
      expect.objectContaining({
        message: "Task cannot be assigned to more than one assignee",
      }),
    ]);
  });

  it("rejects coworker and user assignees together", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeId: "cow_1", assigneeUserId: "user_1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toHaveLength(1);
  });

  it("accepts only a user assignee", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeUserId: "user_1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toEqual([]);
  });
});

describe("nextAssigneeWrite", () => {
  it("treats an empty coworker id as absent so an orchestrator write sticks", () => {
    expect(
      nextAssigneeWrite({
        assigneeId: "",
        assigneeOrchestratorId: "bot-1",
      }),
    ).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: "bot-1",
      assigneeUserId: null,
    });
  });

  it("clears both fields when the provided coworker id is empty", () => {
    expect(nextAssigneeWrite({ assigneeId: "   " })).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });

  it("writes a coworker assignee and clears the orchestrator", () => {
    expect(nextAssigneeWrite({ assigneeId: "cow_1" })).toEqual({
      assigneeId: "cow_1",
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });

  it("writes a user assignee and clears the agent assignees", () => {
    expect(nextAssigneeWrite({ assigneeUserId: "user_1" })).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
      assigneeUserId: "user_1",
    });
  });

  it("unsets all assignees when assigneeUserId is null", () => {
    expect(nextAssigneeWrite({ assigneeUserId: null })).toEqual({
      assigneeId: null,
      assigneeOrchestratorId: null,
      assigneeUserId: null,
    });
  });
});
