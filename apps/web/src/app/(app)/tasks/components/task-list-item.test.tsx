import { TaskStatus, TaskVisibility } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

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

vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatShortDate: () => "Mar 1" }),
}));

function buildTask(visibility: TaskVisibility): TaskWithCoworker {
  return {
    id: "task-1",
    name: "Ship filter",
    status: TaskStatus.READY,
    identifier: null,
    priority: "NONE",
    visibility,
    description: null,
    descriptionPlain: null,
    ownerId: "user-1",
    owner: { id: "user-1", name: "Owner", image: null },
    project: null,
    assignee: null,
    participants: [],
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

describe("TaskListItem priority", () => {
  it("shows the priority icon before the name", () => {
    render(
      <TaskListItem
        task={{ ...buildTask(TaskVisibility.PUBLIC), priority: "URGENT" }}
      />,
    );

    const icon = screen.getByRole("img", { name: "URGENT" });
    const name = screen.getByText("Ship filter");
    expect(
      icon.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the priority icon when there is none", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByRole("img", { name: "NONE" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-priority]")).toBeNull();
  });
});

describe("TaskListItem short id", () => {
  it("shows the identifier before the name and links with the slug URL", () => {
    render(
      <TaskListItem
        task={{
          ...buildTask(TaskVisibility.PUBLIC),
          identifier: "SOK-12",
        }}
      />,
    );

    const identifier = screen.getByText("SOK-12");
    expect(identifier).toHaveClass("text-muted-foreground", "tabular-nums");
    expect(
      identifier.compareDocumentPosition(screen.getByText("Ship filter")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ship filter/ })).toHaveAttribute(
      "href",
      "/tasks/SOK-12-ship-filter",
    );
  });

  it("shows no identifier and links by id without a project", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByText(/^SOK-/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ship filter/ })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
  });
});

describe("TaskListItem description preview", () => {
  it("hides description and project in Compact and restores them in Normal", () => {
    const task = {
      ...buildTask(TaskVisibility.PRIVATE),
      descriptionPlain: "Full instructions remain in task detail.",
      project: {
        id: "project-1",
        name: "Launch project",
        identifier: "SOK",
        logo: null,
      },
    };
    const { rerender } = render(<TaskListItem task={task} />);
    expect(screen.getByText(task.descriptionPlain)).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: task.project.name }),
    ).toBeInTheDocument();
    rerender(<TaskListItem task={task} compact />);
    expect(screen.queryByText(task.descriptionPlain)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: task.project.name }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ship filter/ })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    expect(screen.getByText("Mar 1")).toBeInTheDocument();
    rerender(<TaskListItem task={task} compact={false} />);
    expect(
      screen.getByRole("img", { name: task.project.name }),
    ).toBeInTheDocument();
    expect(screen.getByText(task.descriptionPlain)).toBeInTheDocument();
  });
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

describe("TaskListItem actor cluster", () => {
  it("caps the assignee and participants at three faces plus a remainder, without the owner", () => {
    const people = ["Ada", "Bea", "Cy", "Dee"].map((name) => ({
      id: `user-${name}`,
      name,
      image: null,
      kind: "user" as const,
    }));
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      assignee: { id: "cow-1", name: "Soko", kind: "coworker" as const },
      participants: people,
    };

    render(<TaskListItem task={task} />);

    expect(screen.getAllByTestId("task-actor-face")).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Soko, Ada, Bea, Cy, Dee" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Owner/)).not.toBeInTheDocument();
  });
});
