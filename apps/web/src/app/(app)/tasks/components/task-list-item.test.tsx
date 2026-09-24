import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { TaskStatus, TaskVisibility } from "@/lib/clients/generated/core";

import { TaskListItem } from "./task-list-item";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "privateBadge" ? "Private" : key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("./task-detail-link", () => ({
  TaskDetailLink: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a {...props} data-testid="task-detail-link">
      {children}
    </a>
  ),
}));

vi.mock("./task-meta", () => ({
  TaskMetaDetails: () => <div data-testid="task-meta" />,
}));

function buildTask(visibility: TaskVisibility): TaskWithCoworker {
  return {
    id: "task-1",
    name: "Ship filter",
    status: TaskStatus.READY,
    visibility,
    description: null,
    descriptionPlain: null,
    ownerId: "user-1",
    owner: { id: "user-1", name: "Owner", image: null },
    project: null,
    assignee: null,
    commentsCount: 0,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    jobsCount: 0,
    columnId: "todo",
    events: [],
    agents: [],
  };
}

describe("TaskListItem privacy cue", () => {
  it("uses the hover step past the card surface", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(
      screen.getByTestId("task-detail-link").className.split(/\s+/),
    ).toContain("hover:bg-card-background-hover");
  });

  it("shows the privacy icon beside status for PRIVATE tasks", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PRIVATE)} />);

    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("hides the privacy icon for PUBLIC tasks", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
  });
});

describe("TaskListItem description preview", () => {
  it("shows an em dash instead of raw context attachment markdown", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      description: "[CONTEXT.md](https://blob.example/CONTEXT.md)",
      descriptionPlain: null,
    };

    render(<TaskListItem task={task} />);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/CONTEXT\.md/)).not.toBeInTheDocument();
  });
});

describe("TaskListItem Run at badge", () => {
  it("shows when a Queued Task starts", () => {
    const runAt = "2030-01-02T09:00:00.000Z";
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      status: TaskStatus.QUEUED,
      runAt,
    };

    const { container } = render(<TaskListItem task={task} />);

    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", runAt);
    expect(time).toHaveTextContent("at");
  });

  it("stays hidden without a Run at", () => {
    const { container } = render(
      <TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />,
    );

    expect(container.querySelector("time")).toBeNull();
  });
});
