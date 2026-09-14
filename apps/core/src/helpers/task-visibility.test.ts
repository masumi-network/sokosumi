import { TaskVisibility } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  buildCoworkerPrivateTaskVisibilityWhere,
  buildHumanParentTaskVisibilityWhere,
  buildHumanTaskVisibilityWhere,
  buildSokoBotOwnerTaskVisibilityWhere,
  isPrivateTaskVisibleToCoworker,
  isPrivateTaskVisibleToHuman,
} from "./task-visibility";

describe("task visibility helpers", () => {
  it("lets humans see public Tasks and their own private Tasks", () => {
    expect(buildHumanTaskVisibilityWhere("user_a")).toEqual({
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_a" },
      ],
    });

    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PUBLIC, ownerId: "user_b" },
        "user_a",
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_a" },
        "user_a",
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToHuman(
        { visibility: TaskVisibility.PRIVATE, ownerId: "user_b" },
        "user_a",
      ),
    ).toBe(false);
  });

  it("reuses human visibility for parent-task and Soko Bot owner filters", () => {
    const humanWhere = buildHumanTaskVisibilityWhere("user_a");

    expect(buildHumanParentTaskVisibilityWhere("user_a")).toEqual(humanWhere);
    expect(buildSokoBotOwnerTaskVisibilityWhere("user_a")).toEqual(humanWhere);
  });

  it("keeps private Tasks on the coworker vendor-family seam", () => {
    expect(
      buildCoworkerPrivateTaskVisibilityWhere({
        coworkerId: "cow_1",
        vendorId: "vendor_1",
      }),
    ).toEqual({
      OR: [
        { visibility: TaskVisibility.PUBLIC },
        { visibility: TaskVisibility.PRIVATE, assigneeId: "cow_1" },
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: { not: "cow_1" },
          assignee: { vendorId: "vendor_1" },
        },
      ],
    });

    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_1",
          assignee: { vendorId: "vendor_1" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_2",
          assignee: { vendorId: "vendor_1" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(true);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: "cow_3",
          assignee: { vendorId: "vendor_other" },
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(false);
    expect(
      isPrivateTaskVisibleToCoworker(
        {
          visibility: TaskVisibility.PRIVATE,
          assigneeId: null,
          assignee: null,
        },
        { coworkerId: "cow_1", vendorId: "vendor_1" },
      ),
    ).toBe(false);
  });
});
