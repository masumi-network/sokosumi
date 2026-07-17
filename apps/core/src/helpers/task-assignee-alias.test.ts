import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  refineAssigneeIdAliasConflict,
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
