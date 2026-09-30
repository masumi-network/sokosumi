import { TaskStatus } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
  }),
}));

const relationLabels = {
  related: "Related",
  blocks: "Blocking",
  blocked_by: "Blocked by",
  parent: "Sub-task",
  child: "Parent task",
  duplicate: "Duplicate",
};

const statusLabels = {
  [TaskStatus.READY]: "Ready",
  [TaskStatus.DRAFT]: "Draft",
} as Record<TaskStatus, string>;

function renderRelated(
  tasks: React.ComponentProps<typeof TaskRelatedTasks>["tasks"],
) {
  return render(
    <TaskRelatedTasks
      title="Linked tasks"
      tasks={tasks}
      relationLabels={relationLabels}
      statusLabels={statusLabels}
    />,
  );
}

describe("TaskRelatedTasks", () => {
  it("renders nothing when there are no linked tasks", () => {
    const { container } = renderRelated([]);

    expect(container).toBeEmptyDOMElement();
  });

  it("groups rows under relation subheadings in a fixed order", () => {
    renderRelated([
      {
        id: "t-dup",
        name: "Dup",
        identifier: null,
        status: TaskStatus.DRAFT,
        relation: "duplicate",
      },
      {
        id: "t-rel",
        name: "Rel",
        identifier: null,
        status: TaskStatus.READY,
        relation: "related",
      },
      {
        id: "t-sub",
        name: "Sub",
        identifier: null,
        status: TaskStatus.READY,
        relation: "parent",
      },
      {
        id: "t-par",
        name: "Par",
        identifier: null,
        status: TaskStatus.READY,
        relation: "child",
      },
      {
        id: "t-blk",
        name: "Blk",
        identifier: null,
        status: TaskStatus.READY,
        relation: "blocks",
      },
      {
        id: "t-by",
        name: "By",
        identifier: null,
        status: TaskStatus.READY,
        relation: "blocked_by",
      },
    ]);

    expect(
      screen.getByRole("heading", { level: 2, name: "Linked tasks" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Blocked by",
      "Blocking",
      "Parent task",
      "Sub-task",
      "Related",
      "Duplicate",
    ]);
  });

  it("lists each task once, linked, under its own group and without a relation badge", () => {
    renderRelated([
      {
        id: "task-2",
        name: "Design follow-up",
        identifier: null,
        status: TaskStatus.READY,
        relation: "related",
      },
      {
        id: "task-3",
        name: "API migration",
        identifier: null,
        status: TaskStatus.DRAFT,
        relation: "blocks",
      },
      {
        id: "task-4",
        name: "Schema update",
        identifier: null,
        status: TaskStatus.READY,
        relation: "blocks",
      },
    ]);

    const blocksGroup = screen.getByRole("group", { name: "Blocking" });
    expect(within(blocksGroup).getAllByRole("link")).toHaveLength(2);
    expect(
      within(blocksGroup).getByRole("link", { name: /API migration/ }),
    ).toHaveAttribute("href", "/tasks/task-3");
    expect(
      screen.getByRole("link", { name: /Design follow-up/ }),
    ).toHaveAttribute("href", "/tasks/task-2");
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveTextContent(/Related|Blocking/);
      expect(within(link).queryByLabelText(/Related|Blocking/)).toBeNull();
    }
  });

  it("omits groups that have no tasks", () => {
    renderRelated([
      {
        id: "task-2",
        name: "Only one",
        identifier: null,
        status: TaskStatus.READY,
        relation: "related",
      },
    ]);

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.queryByText("Blocking")).not.toBeInTheDocument();
  });
});
