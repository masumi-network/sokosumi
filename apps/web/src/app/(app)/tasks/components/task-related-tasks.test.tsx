import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRelatedTasks } from "@/app/tasks/components/task-related-tasks";
import { TaskStatus } from "@/lib/clients/generated/core";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
  }),
}));

const relationLabels = {
  related: "Related",
  blocks: "Blocks",
  blocked_by: "Blocked by",
  parent: "Sub-task",
  child: "Parent task",
  duplicate: "Duplicate",
};

describe("TaskRelatedTasks", () => {
  it("renders the section title and empty copy when there are no linked tasks", () => {
    render(
      <TaskRelatedTasks
        title="Linked tasks"
        emptyLabel="No linked tasks yet."
        tasks={[]}
        relationLabels={relationLabels}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Linked tasks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No linked tasks yet.")).toBeInTheDocument();
  });

  it("renders icon-only relation badges with accessible names and native title hints", () => {
    render(
      <TaskRelatedTasks
        title="Linked tasks"
        emptyLabel="No linked tasks yet."
        relationLabels={relationLabels}
        tasks={[
          {
            id: "task-2",
            name: "Design follow-up",
            status: TaskStatus.READY,
            relation: "related",
          },
          {
            id: "task-3",
            name: "Dependency cleanup",
            status: TaskStatus.DRAFT,
            relation: "duplicate",
          },
          {
            id: "task-4",
            name: "Draft API schema",
            status: TaskStatus.READY,
            relation: "parent",
          },
          {
            id: "task-5",
            name: "Master roadmap",
            status: TaskStatus.READY,
            relation: "child",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Linked tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Design follow-up/i }),
    ).toHaveAttribute("href", "/tasks/task-2");
    expect(
      screen.getByRole("link", { name: /Dependency cleanup/i }),
    ).toHaveAttribute("href", "/tasks/task-3");
    expect(
      screen.getByRole("link", { name: /Draft API schema/i }),
    ).toHaveAttribute("href", "/tasks/task-4");
    expect(
      screen.getByRole("link", { name: /Master roadmap/i }),
    ).toHaveAttribute("href", "/tasks/task-5");

    expect(screen.getByLabelText("Related")).toBeInTheDocument();
    expect(screen.getByLabelText("Duplicate")).toBeInTheDocument();
    expect(screen.getByLabelText("Sub-task")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent task")).toBeInTheDocument();
    expect(screen.queryByText("Related")).not.toBeInTheDocument();

    expect(screen.getByLabelText("Related")).toHaveAttribute(
      "title",
      "Related",
    );
    expect(screen.getByLabelText("Duplicate")).toHaveAttribute(
      "title",
      "Duplicate",
    );
  });

  it("uses destructive relation badges for blocking states", () => {
    render(
      <TaskRelatedTasks
        title="Linked tasks"
        emptyLabel="No linked tasks yet."
        relationLabels={relationLabels}
        tasks={[
          {
            id: "task-2",
            name: "API migration",
            status: TaskStatus.READY,
            relation: "blocks",
          },
          {
            id: "task-3",
            name: "Schema update",
            status: TaskStatus.DRAFT,
            relation: "blocked_by",
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Blocks")).toHaveClass("text-destructive");
    expect(screen.getByLabelText("Blocked by")).toHaveClass("text-destructive");
  });
});
