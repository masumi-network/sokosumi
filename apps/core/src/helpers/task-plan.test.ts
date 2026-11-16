import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { buildTaskPlan, type TaskPlanEdge } from "./task-plan";

function peer(id: string) {
  return {
    id,
    name: `Task ${id}`,
    status: TaskStatus.READY,
    archivedAt: null,
    number: null,
    project: null,
  };
}

function edges(
  map: Record<string, [TaskPlanEdge["relation"], string][]>,
): Map<string, TaskPlanEdge[]> {
  return new Map(
    Object.entries(map).map(([taskId, list]) => [
      taskId,
      list.map(([relation, id]) => ({ relation, peer: peer(id) })),
    ]),
  );
}

function rows(plan: ReturnType<typeof buildTaskPlan>) {
  return plan.items.map(
    (item) =>
      `${item.depth} ${item.relation} ${item.task.id}${item.repeat ? ` ${item.repeat}` : ""}${item.hasMore ? " more" : ""}`,
  );
}

describe("buildTaskPlan", () => {
  it("walks blockers before sub-tasks, depth first", () => {
    const plan = buildTaskPlan(
      "root",
      edges({
        root: [
          ["parent", "a"],
          ["blocked_by", "b"],
        ],
        a: [["parent", "a1"]],
        b: [["blocked_by", "b1"]],
      }),
    );

    expect(rows(plan)).toEqual([
      "1 blocked_by b",
      "2 blocked_by b1",
      "1 parent a",
      "2 parent a1",
    ]);
    expect(plan.truncated).toBe(false);
  });

  it("stops at three links and says when there is more beyond", () => {
    const plan = buildTaskPlan(
      "root",
      edges({
        root: [["parent", "a"]],
        a: [["parent", "b"]],
        b: [["parent", "c"]],
        c: [["parent", "d"]],
      }),
    );

    expect(rows(plan)).toEqual(["1 parent a", "2 parent b", "3 parent c more"]);
  });

  it("marks a loop back to an ancestor and does not expand it", () => {
    const plan = buildTaskPlan(
      "root",
      edges({
        root: [["blocked_by", "a"]],
        a: [["blocked_by", "root"]],
      }),
    );

    expect(rows(plan)).toEqual([
      "1 blocked_by a",
      "2 blocked_by root loops_back",
    ]);
  });

  it("marks a Task reached again on another branch as shown above", () => {
    const plan = buildTaskPlan(
      "root",
      edges({
        root: [
          ["blocked_by", "a"],
          ["parent", "b"],
        ],
        a: [["blocked_by", "shared"]],
        b: [["blocked_by", "shared"]],
        shared: [["parent", "s1"]],
      }),
    );

    expect(rows(plan)).toEqual([
      "1 blocked_by a",
      "2 blocked_by shared",
      "3 parent s1",
      "1 parent b",
      "2 blocked_by shared shown_above",
    ]);
  });

  it("caps the number of rows and marks the plan truncated", () => {
    const children = Array.from(
      { length: 40 },
      (_, index): [TaskPlanEdge["relation"], string] => ["parent", `c${index}`],
    );
    const plan = buildTaskPlan("root", edges({ root: children }));

    expect(plan.items).toHaveLength(30);
    expect(plan.truncated).toBe(true);
  });

  it("returns an empty plan for a Task with no visible links", () => {
    expect(buildTaskPlan("root", new Map())).toEqual({
      items: [],
      truncated: false,
    });
  });
});
