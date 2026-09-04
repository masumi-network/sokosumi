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
  it("allows an empty coworker id with a soko bot assignee", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeId: "", assigneeSokoBotId: "bot-1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toEqual([]);
  });

  it("rejects two non-empty assignee identifiers", () => {
    const issues: Array<{ message: string }> = [];
    refineAssigneeXorConflict(
      { assigneeId: "cow_1", assigneeSokoBotId: "bot-1" },
      { addIssue: (issue) => issues.push(issue) },
    );
    expect(issues).toEqual([
      expect.objectContaining({
        message: "assigneeId and assigneeSokoBotId cannot both be set",
      }),
    ]);
  });
});

describe("nextAssigneeWrite", () => {
  it("treats an empty coworker id as absent so a soko bot write sticks", () => {
    expect(
      nextAssigneeWrite({
        assigneeId: "",
        assigneeSokoBotId: "bot-1",
      }),
    ).toEqual({
      assigneeId: null,
      assigneeSokoBotId: "bot-1",
    });
  });

  it("clears both fields when the provided coworker id is empty", () => {
    expect(nextAssigneeWrite({ assigneeId: "   " })).toEqual({
      assigneeId: null,
      assigneeSokoBotId: null,
    });
  });

  it("writes a coworker assignee and clears the soko bot", () => {
    expect(nextAssigneeWrite({ assigneeId: "cow_1" })).toEqual({
      assigneeId: "cow_1",
      assigneeSokoBotId: null,
    });
  });
});
