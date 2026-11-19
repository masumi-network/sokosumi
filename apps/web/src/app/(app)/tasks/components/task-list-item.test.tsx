import { TaskStatus, TaskVisibility } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

import { TaskListItem } from "./task-list-item";
import { ShowOpenSubtasksContext } from "./task-open-subtasks";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "privateBadge" ? "Private" : key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
  useNow: () => new Date("2026-03-10T00:00:00.000Z"),
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({ date }: { date: string }) => <time>{date}</time>,
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
  it("uses the hover fill every row uses", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(
      screen.getByTestId("task-detail-link").className.split(/\s+/),
    ).toContain("hover:bg-accent");
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

it("shows a saved Jev workspace tag and a name-only overflow summary inside the Task link", () => {
  const task: TaskWithCoworker = {
    ...buildTask(TaskVisibility.PUBLIC),
    workspaceTags: [
      {
        id: "procurement",
        displayName: "Procurement",
        color: "green",
        source: "jev",
      },
    ],
    tags: { manual: ["design"], automatic: ["research"], rejected: [] },
  };
  const { rerender } = render(<TaskListItem task={task} compact={false} />);
  const badge = screen.getByText("Procurement").closest("[data-slot=badge]");
  expect(badge).toHaveTextContent(/^Procurement$/);
  expect(badge).toHaveAttribute("data-tag-color", "green");
  expect(badge).not.toHaveAttribute("title");
  expect(badge?.querySelector("svg")).toBeNull();
  expect(screen.getByText("+2")).toHaveAttribute(
    "title",
    "vocabulary.design, vocabulary.research",
  );
  rerender(<TaskListItem task={task} compact />);
  expect(screen.getByText("+1")).toHaveAttribute(
    "title",
    "vocabulary.research",
  );
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

describe("TaskListItem one-line row", () => {
  it("leaves the description and a zero comment count to the Task page", () => {
    const task = {
      ...buildTask(TaskVisibility.PRIVATE),
      descriptionPlain: "Full instructions remain in task detail.",
      commentsCount: 0,
    };
    const { rerender } = render(<TaskListItem task={task} />);

    expect(screen.queryByText(task.descriptionPlain)).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Private")).toBeInTheDocument();

    rerender(<TaskListItem task={{ ...task, commentsCount: 4 }} />);
    expect(screen.getByText("4")).toBeInTheDocument();
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

describe("TaskListItem time in status", () => {
  it("shows how long a waiting Task has sat in its status", () => {
    render(
      <TaskListItem
        task={{
          ...buildTask(TaskVisibility.PUBLIC),
          statusSince: "2026-03-01T00:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("stuck")).toBeVisible();
    expect(screen.getByText("2026-03-01T00:00:00.000Z")).toBeTruthy();
  });

  it("shows nothing without a status time", () => {
    render(<TaskListItem task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByText("stuck")).toBeNull();
    expect(screen.queryByText("label")).toBeNull();
  });
});

describe("TaskListItem open sub-tasks", () => {
  it("lists them beside the row's link, never inside it", () => {
    render(
      <ShowOpenSubtasksContext value>
        <TaskListItem
          task={{
            ...buildTask(TaskVisibility.PUBLIC),
            subtaskProgress: { completed: 0, total: 1 },
            openSubtasks: [
              {
                id: "sub-1",
                identifier: null,
                name: "Write copy",
                status: TaskStatus.READY,
              },
            ],
          }}
        />
      </ShowOpenSubtasksContext>,
    );

    const subtaskLink = screen.getByText("Write copy").closest("a");
    expect(subtaskLink).toHaveAttribute("href", "/tasks/sub-1");
    // A link inside a link is invalid HTML; the browser splits the row.
    expect(subtaskLink?.parentElement?.closest("a")).toBeNull();
  });
});
