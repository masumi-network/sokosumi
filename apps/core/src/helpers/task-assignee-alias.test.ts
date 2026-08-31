import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  refineAssigneeIdAliasConflict,
  refineAssigneeKindConflict,
  resolveAssigneeIdFromRequest,
  resolveNextTaskAssignees,
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

describe("refineAssigneeKindConflict", () => {
  const schema = z
    .object({
      assigneeId: z.string().nullish(),
      assigneeUserId: z.string().nullish(),
    })
    .superRefine(refineAssigneeKindConflict);

  it("rejects coworker and user ids together", () => {
    expect(() =>
      schema.parse({
        assigneeId: "cow_a",
        assigneeUserId: "user_a",
      }),
    ).toThrow();
  });

  it("accepts only a user assignee", () => {
    expect(
      schema.parse({
        assigneeUserId: "user_a",
      }),
    ).toEqual({
      assigneeUserId: "user_a",
    });
  });
});

describe("resolveNextTaskAssignees", () => {
  it("clears the coworker when assigning a user", () => {
    expect(
      resolveNextTaskAssignees(
        { assigneeUserId: "user_new" },
        { assigneeId: "cow_old", assigneeUserId: null },
      ),
    ).toEqual({
      assigneeId: null,
      assigneeUserId: "user_new",
    });
  });

  it("clears the user when assigning a coworker", () => {
    expect(
      resolveNextTaskAssignees(
        { assigneeId: "cow_new" },
        { assigneeId: null, assigneeUserId: "user_old" },
      ),
    ).toEqual({
      assigneeId: "cow_new",
      assigneeUserId: null,
    });
  });

  it("unsets both when assigneeUserId is null", () => {
    expect(
      resolveNextTaskAssignees(
        { assigneeUserId: null },
        { assigneeId: null, assigneeUserId: "user_old" },
      ),
    ).toEqual({
      assigneeId: null,
      assigneeUserId: null,
    });
  });

  it("keeps the other side when only one field is omitted", () => {
    expect(
      resolveNextTaskAssignees(
        {},
        { assigneeId: null, assigneeUserId: "user_old" },
      ),
    ).toEqual({
      assigneeId: null,
      assigneeUserId: "user_old",
    });
  });
});
