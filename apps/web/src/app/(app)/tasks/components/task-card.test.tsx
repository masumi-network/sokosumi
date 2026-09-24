import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { TaskStatus, TaskVisibility } from "@/lib/clients/generated/core";

import { TaskCard } from "./task-card";

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

describe("TaskCard privacy cue", () => {
  it("shows the privacy icon on the status row for PRIVATE tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PRIVATE)} />);

    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("hides the privacy icon for PUBLIC tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
  });
});

describe("TaskCard description preview", () => {
  it("does not render a blank preview for context-only raw description", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      description: "[CONTEXT.md](https://blob.example/CONTEXT.md)",
      descriptionPlain: null,
    };

    const { container } = render(<TaskCard task={task} />);

    expect(container.textContent).not.toContain("CONTEXT.md");
    expect(
      container.querySelector(".text-muted-foreground.line-clamp-2"),
    ).toBeNull();
  });

  it("renders descriptionPlain when present", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      description: "[CONTEXT.md](https://blob.example/CONTEXT.md)\n\nHello",
      descriptionPlain: "Hello",
    };

    render(<TaskCard task={task} />);

    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});

describe("TaskCard Run at badge", () => {
  it("shows when a Queued Task starts", () => {
    const runAt = "2030-01-02T09:00:00.000Z";
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      status: TaskStatus.QUEUED,
      runAt,
    };

    const { container } = render(<TaskCard task={task} />);

    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", runAt);
    expect(time).toHaveTextContent("at");
  });

  it("stays hidden without a Run at", () => {
    const { container } = render(
      <TaskCard task={buildTask(TaskVisibility.PUBLIC)} />,
    );

    expect(container.querySelector("time")).toBeNull();
  });
});

describe("TaskCard actor cluster", () => {
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

    render(<TaskCard task={task} />);

    expect(screen.getAllByTestId("task-actor-face")).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Soko, Ada, Bea, Cy, Dee" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Owner/)).not.toBeInTheDocument();
  });
});
