import { describe, expect, it } from "vitest";

import {
  coworkerNameFromCoreAssignee,
  decodeTaskAssigneeValue,
  defaultTaskAssigneeValue,
  encodeTaskAssigneeValue,
  mapCoreAssigneeToBoardAssignee,
  taskAssigneeIdsFromSelection,
  taskAssigneeKindFromBoardAssignee,
  taskAssigneeKindFromIds,
  UNSET_TASK_ASSIGNEE_VALUE,
} from "./task-assignee";

describe("task-assignee", () => {
  it("encodes unset, coworker, and user values", () => {
    expect(encodeTaskAssigneeValue({ kind: "unset" })).toBe(
      UNSET_TASK_ASSIGNEE_VALUE,
    );
    expect(encodeTaskAssigneeValue({ kind: "coworker", id: "cow-1" })).toBe(
      "coworker:cow-1",
    );
    expect(encodeTaskAssigneeValue({ kind: "user", id: "user-1" })).toBe(
      "user:user-1",
    );
  });

  it("decodes encoded values and treats empty as unset", () => {
    expect(decodeTaskAssigneeValue("coworker:cow-1")).toEqual({
      kind: "coworker",
      id: "cow-1",
    });
    expect(decodeTaskAssigneeValue("user:user-1")).toEqual({
      kind: "user",
      id: "user-1",
    });
    expect(decodeTaskAssigneeValue(UNSET_TASK_ASSIGNEE_VALUE)).toEqual({
      kind: "unset",
    });
    expect(decodeTaskAssigneeValue("")).toEqual({ kind: "unset" });
    expect(decodeTaskAssigneeValue("coworker:")).toEqual({ kind: "unset" });
  });

  it("maps a selection to Core assignee ids", () => {
    expect(
      taskAssigneeIdsFromSelection({ kind: "coworker", id: "cow-1" }),
    ).toEqual({
      assigneeId: "cow-1",
      assigneeUserId: null,
    });
    expect(
      taskAssigneeIdsFromSelection({ kind: "user", id: "user-1" }),
    ).toEqual({
      assigneeId: null,
      assigneeUserId: "user-1",
    });
    expect(taskAssigneeIdsFromSelection({ kind: "unset" })).toEqual({
      assigneeId: null,
      assigneeUserId: null,
    });
  });

  it("derives assignee kind from ids and board assignee", () => {
    expect(taskAssigneeKindFromIds("cow-1", null)).toBe("coworker");
    expect(taskAssigneeKindFromIds(null, "user-1")).toBe("human");
    expect(taskAssigneeKindFromIds(null, null)).toBe("unset");
    expect(
      taskAssigneeKindFromBoardAssignee({
        kind: "user",
        id: "user-1",
        name: "Ada",
      }),
    ).toBe("human");
    expect(taskAssigneeKindFromBoardAssignee(null)).toBe("unset");
  });

  it("maps Core coworker and user assignees onto the board model", () => {
    expect(
      mapCoreAssigneeToBoardAssignee({
        type: "coworker",
        id: "cow-1",
        coworker: {
          id: "cow-1",
          name: "Elena",
          image: null,
          slug: "elena",
        },
      }),
    ).toEqual({
      kind: "coworker",
      id: "cow-1",
      name: "Elena",
      image: null,
      slug: "elena",
    });
    expect(
      mapCoreAssigneeToBoardAssignee({
        type: "user",
        id: "user-1",
        user: { id: "user-1", name: "Ada", image: null },
      }),
    ).toEqual({
      kind: "user",
      id: "user-1",
      name: "Ada",
      image: null,
    });
    expect(mapCoreAssigneeToBoardAssignee(null)).toBeNull();
  });

  it("reads coworker display name from a Core coworker assignee", () => {
    expect(
      coworkerNameFromCoreAssignee({
        type: "coworker",
        id: "cow-1",
        coworker: {
          id: "cow-1",
          name: "Elena",
          image: null,
          slug: "elena",
        },
      }),
    ).toBe("Elena");
    expect(
      coworkerNameFromCoreAssignee({
        type: "user",
        id: "user-1",
        user: { id: "user-1", name: "Ada", image: null },
      }),
    ).toBeNull();
    expect(coworkerNameFromCoreAssignee(null)).toBeNull();
  });

  it("defaults create to Elena and keeps edit human/unset", () => {
    const coworkers = [
      { id: "cow-2", slug: "ada", name: "Ada" },
      { id: "cow-1", slug: "elena", name: "Elena" },
    ];

    expect(
      defaultTaskAssigneeValue({
        mode: "create",
        coworkerOptions: coworkers,
      }),
    ).toBe("coworker:cow-1");
    expect(
      defaultTaskAssigneeValue({
        mode: "edit",
        assigneeUserId: "user-1",
        coworkerOptions: coworkers,
      }),
    ).toBe("user:user-1");
    expect(
      defaultTaskAssigneeValue({
        mode: "edit",
        coworkerOptions: coworkers,
      }),
    ).toBe(UNSET_TASK_ASSIGNEE_VALUE);
  });
});
