import type { TaskPlan, TaskPlanItem } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskPlanTree } from "./task-plan";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));

vi.mock("@/lib/services/task.service", () => ({ taskService: {} }));

const labels = {
  title: "Plan around this task",
  hint: "Blockers and sub-tasks up to 3 links away.",
  blockedBy: "Blocked by",
  subtask: "Sub-task",
  loopsBack: "Loops back to an earlier task",
  shownAbove: "Shown above",
  more: "More beyond this view",
  truncated: "Only part of the plan is shown.",
};

function item(
  id: string,
  depth: number,
  relation: TaskPlanItem["relation"],
  extra: Partial<TaskPlanItem> = {},
): TaskPlanItem {
  return {
    depth,
    relation,
    task: {
      id,
      name: `Task ${id}`,
      status: "READY",
      archivedAt: null,
      identifier: null,
    },
    repeat: null,
    hasMore: false,
    ...extra,
  };
}

function renderPlan(plan: TaskPlan) {
  return render(
    <TaskPlanTree
      plan={plan}
      labels={labels}
      statusLabels={{ READY: "Ready" } as never}
    />,
  );
}

describe("TaskPlanTree", () => {
  it("nests deeper Tasks under the Task they belong to", () => {
    renderPlan({
      truncated: false,
      items: [
        item("b", 1, "blocked_by"),
        item("b1", 2, "parent"),
        item("a", 1, "parent"),
      ],
    });

    const tree = screen.getByRole("list", { name: labels.title });
    const top = Array.from(tree.children);
    expect(top.map((li) => li.querySelector("a")?.textContent)).toEqual([
      "Task b",
      "Task a",
    ]);
    const nested = within(top[0] as HTMLElement).getByRole("link", {
      name: /Task b1/,
    });
    expect(nested).toHaveAttribute("href", expect.stringContaining("b1"));
    expect(
      within(top[0] as HTMLElement).getByRole("img", { name: "Blocked by" }),
    ).toBeInTheDocument();
  });

  it("names a row's relation in a tooltip on its icon", async () => {
    renderPlan({
      truncated: false,
      items: [item("b", 1, "blocked_by"), item("b1", 2, "parent")],
    });

    await userEvent.hover(screen.getByRole("img", { name: "Sub-task" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Sub-task");
  });

  it("says when a row repeats, loops back, or goes deeper than shown", () => {
    renderPlan({
      truncated: true,
      items: [
        item("a", 1, "blocked_by"),
        item("root", 2, "blocked_by", { repeat: "loops_back" }),
        item("c", 1, "parent", { repeat: "shown_above" }),
        item("d", 1, "parent", { hasMore: true }),
      ],
    });

    expect(screen.getByText(labels.loopsBack)).toBeInTheDocument();
    expect(screen.getByText(labels.shownAbove)).toBeInTheDocument();
    expect(screen.getByText(labels.more)).toBeInTheDocument();
    expect(screen.getByText(labels.truncated)).toBeInTheDocument();
  });

  it("renders nothing when every row is a direct link already listed above", () => {
    const { container } = renderPlan({
      truncated: false,
      items: [item("a", 1, "parent"), item("b", 1, "blocked_by")],
    });

    expect(container).toBeEmptyDOMElement();
  });
});
