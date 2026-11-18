import { DndContext } from "@dnd-kit/core";
import { TaskStatus, TaskVisibility } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

import { KanbanBoard } from "./kanban-board";
import { TaskCard } from "./task-card";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "privateBadge" ? "Private" : key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
  useNow: () => new Date(),
  useTimeZone: () => "UTC",
}));

vi.mock("@/components/time-ago", () => ({ TimeAgo: () => null }));

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

describe("TaskCard privacy cue", () => {
  it("shows sub-task progress, and nothing for a Task without sub-tasks", () => {
    const task = buildTask(TaskVisibility.PUBLIC);
    const { rerender } = render(
      <TaskCard
        task={{ ...task, subtaskProgress: { completed: 2, total: 3 } }}
      />,
    );
    expect(screen.getByText("2/3")).toBeTruthy();

    rerender(
      <TaskCard
        task={{ ...task, subtaskProgress: { completed: 0, total: 0 } }}
      />,
    );
    expect(screen.queryByText("0/0")).toBeNull();
  });

  it("shows the privacy icon on the status row for PRIVATE tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PRIVATE)} />);

    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("hides the privacy icon for PUBLIC tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
  });
});

describe("TaskCard status", () => {
  it("drops the status word the column already names, and keeps its name for assistive technology", () => {
    const task = buildTask(TaskVisibility.PUBLIC);
    const { rerender } = render(<TaskCard task={task} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();

    rerender(<TaskCard task={task} quietStatus={TaskStatus.READY} />);
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ready" })).toBeInTheDocument();

    rerender(<TaskCard task={task} quietStatus={TaskStatus.RUNNING} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows how long a Task has waited only once it is stuck", () => {
    const day = 24 * 60 * 60 * 1000;
    const since = (days: number) =>
      new Date(Date.now() - days * day).toISOString();
    const task = buildTask(TaskVisibility.PUBLIC);
    const { rerender } = render(
      <TaskCard task={{ ...task, statusSince: since(1) }} />,
    );
    // A fresh waiting Task would say "label" with its age; the card says nothing.
    expect(screen.queryByText("label")).not.toBeInTheDocument();
    expect(screen.queryByText("stuck")).not.toBeInTheDocument();

    rerender(<TaskCard task={{ ...task, statusSince: since(10) }} />);
    expect(screen.getByText("stuck")).toBeInTheDocument();
  });
});

describe("TaskCard dates", () => {
  const task = buildTask(TaskVisibility.PUBLIC);
  const runAt = "2030-01-02T09:00:00.000Z";

  it("shows the start of a scheduled Task in place of a due day still ahead", () => {
    const { container } = render(
      <TaskCard task={{ ...task, runAt, dueOn: "2999-01-01" }} />,
    );

    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(1);
    expect(times[0]).toHaveAttribute("dateTime", runAt);
  });

  it("still says a scheduled Task is overdue", () => {
    const { container } = render(
      <TaskCard task={{ ...task, runAt, dueOn: "2000-01-01" }} />,
    );

    expect(
      Array.from(container.querySelectorAll("time"), (time) =>
        time.getAttribute("dateTime"),
      ),
    ).toEqual([runAt, "2000-01-01"]);
  });
});

describe("TaskCard priority", () => {
  it("shows the priority icon before the name", () => {
    render(
      <TaskCard
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
    render(<TaskCard task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByRole("img", { name: "NONE" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-priority]")).toBeNull();
  });
});

describe("TaskCard short id", () => {
  it("shows the identifier before the name and links with the slug URL", () => {
    render(
      <TaskCard
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
    render(<TaskCard task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByText(/^SOK-/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ship filter/ })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
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

  it("preserves description in data but replaces card preview with tags", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      description: "[CONTEXT.md](https://blob.example/CONTEXT.md)\n\nHello",
      descriptionPlain: "Hello",
    };

    render(<TaskCard task={task} />);

    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    expect(task.description).toContain("Hello");
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

describe("TaskCard project navigation", () => {
  it("keeps project navigation separate from the full-card task link", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      project: {
        id: "project-1",
        name: "Long project name",
        identifier: "SOK",
        logo: null,
      },
    };
    render(<TaskCard task={{ ...task, identifier: "SOK-12" }} />);
    const project = screen.getByRole("link", { name: "SOK-12, openProject" });
    expect(project).toHaveAttribute("href", "/projects/project-1");
    expect(project).toHaveAttribute("title", "Long project name");
    expect(project.closest('[data-testid="task-detail-link"]')).toBeNull();
  });
});

describe("TaskCard without a title", () => {
  it("says so in place of an empty link", () => {
    render(
      <TaskCard task={{ ...buildTask(TaskVisibility.PUBLIC), name: "  " }} />,
    );

    expect(screen.getByRole("link", { name: "noTitle" })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
  });
});

describe("TaskCard without a project", () => {
  it("says so where the identifier would be, and only then", () => {
    const base = buildTask(TaskVisibility.PUBLIC);
    const { rerender } = render(
      <TaskCard task={{ ...base, identifier: null, project: null }} />,
    );
    expect(screen.getByText("noProject")).toBeInTheDocument();

    rerender(
      <TaskCard
        task={{
          ...base,
          identifier: "SOK-12",
          project: {
            id: "project-1",
            name: "Sok",
            identifier: "SOK",
            logo: null,
          },
        }}
      />,
    );
    expect(screen.queryByText("noProject")).not.toBeInTheDocument();
  });
});

describe("TaskCard while it saves", () => {
  it("shows the identifier as text, since a pending Task has nowhere to go", () => {
    const task = {
      ...buildTask(TaskVisibility.PUBLIC),
      isPending: true,
      identifier: "SOK-12",
      project: { id: "project-1", name: "Sok", identifier: "SOK", logo: null },
    };
    render(<TaskCard task={task} />);

    expect(screen.getByText("SOK-12")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("TaskCard density", () => {
  it("tightens the card in Compact and restores it in Normal", () => {
    const task = buildTask(TaskVisibility.PRIVATE);
    const { rerender } = render(<TaskCard task={task} />);
    const normalClasses = screen.getByRole("article").className;
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-2");

    rerender(<TaskCard task={task} compact />);

    expect(screen.getByRole("article").className).not.toBe(normalClasses);
    // The side inset is the same in both densities.
    expect(screen.getByRole("article")).toHaveClass("px-3", "py-2", "gap-1");
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-1");
    expect(screen.getByRole("link", { name: task.name })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
    expect(screen.getByLabelText("Private")).toBeInTheDocument();

    rerender(<TaskCard task={task} compact={false} />);
    expect(screen.getByRole("article").className).toBe(normalClasses);
  });

  it.each([false, true])(
    "hides metadata only in Compact while preserving task and drag controls (compact=%s)",
    (compact) => {
      const onPointerDown = vi.fn();
      const onKeyDown = vi.fn();
      const task: TaskWithCoworker = {
        ...buildTask(TaskVisibility.PUBLIC),
        name: "A long task title that remains available to assistive technology",
        identifier: "SOK-12",
        project: {
          id: "project-1",
          name: "A very long project name with international campaign details",
          identifier: "SOK",
          logo: null,
        },
        tags: {
          manual: ["design", "writing", "research"],
          automatic: [],
          rejected: [],
        },
        // No start time: a scheduled card shows that in place of its tag.
        dueOn: "2999-01-01",
      };
      const { container } = render(
        <TaskCard
          task={task}
          compact={compact}
          dragHandleProps={{
            attributes: {
              role: "button",
              tabIndex: 0,
              "aria-disabled": false,
              "aria-pressed": false,
              "aria-roledescription": "draggable",
              "aria-describedby": "drag-instructions",
            },
            listeners: { onPointerDown, onKeyDown },
            isDragging: false,
          }}
        />,
      );
      expect(screen.getByRole("link", { name: task.name })).toHaveAttribute(
        "title",
        task.name,
      );
      expect(container.querySelector("time")).toHaveAttribute(
        "dateTime",
        task.dueOn,
      );
      // The identifier is the way to the project in both densities.
      const project = screen.getByRole("link", { name: "SOK-12, openProject" });
      expect(project).toHaveAttribute("href", "/projects/project-1");
      fireEvent.pointerDown(project);
      fireEvent.keyDown(project, { key: "Enter" });
      if (compact) {
        expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "showAll" }),
        ).not.toBeInTheDocument();
      } else {
        expect(screen.getByText("vocabulary.design")).toBeInTheDocument();
        const overflow = screen.getByRole("button", { name: "showAll" });
        expect(overflow).toHaveTextContent("+2");
        fireEvent.pointerDown(overflow);
        fireEvent.keyDown(overflow, { key: "Enter" });
      }
      expect(onPointerDown).not.toHaveBeenCalled();
      expect(onKeyDown).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole("heading"));
      expect(onPointerDown).toHaveBeenCalledOnce();
      const draggable = container.querySelector(
        '[aria-roledescription="draggable"]',
      );
      expect(draggable).toHaveAttribute("tabindex", "0");
      if (!draggable) throw new Error("Expected a drag handle");
      fireEvent.keyDown(draggable, { key: " " });
      expect(onKeyDown).toHaveBeenCalledOnce();
    },
  );
});

describe("Compact board card wiring", () => {
  it.each([
    { isDragEnabled: true, canDrag: true },
    { isDragEnabled: true, canDrag: false },
    { isDragEnabled: false, canDrag: true },
  ])(
    "hides metadata in draggable, static and prehydration cards (%j)",
    ({ isDragEnabled, canDrag }) => {
      const task: TaskWithCoworker = {
        ...buildTask(TaskVisibility.PUBLIC),
        project: {
          id: "project-1",
          name: "Launch project",
          identifier: "SOK",
          logo: null,
        },
        tags: { manual: ["design"], automatic: [], rejected: [] },
      };
      const { container } = render(
        <DndContext>
          <KanbanBoard
            tasks={[task]}
            columns={[{ id: "todo", translationKey: "App.Tasks.Columns.todo" }]}
            labels={{
              columns: {
                backlog: "Backlog",
                todo: "To do",
                "in-progress": "In progress",
                "input-required": "Input required",
                done: "Done",
              },
              emptyColumn: "Empty",
            }}
            isDragEnabled={isDragEnabled}
            canDragTask={() => canDrag}
            compact
          />
        </DndContext>,
      );
      expect(screen.getByRole("link", { name: task.name })).toHaveAttribute(
        "href",
        "/tasks/task-1",
      );
      expect(screen.queryByText("Launch project")).not.toBeInTheDocument();
      expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
      expect(Boolean(container.querySelector("[data-dnd-draggable]"))).toBe(
        isDragEnabled && canDrag,
      );
    },
  );
});

describe("TaskCard mention mark", () => {
  it("marks only a Task with an unanswered mention of the reader", () => {
    const task = buildTask(TaskVisibility.PUBLIC);
    const { rerender } = render(<TaskCard task={task} />);
    expect(screen.queryByLabelText(/mention/i)).not.toBeInTheDocument();

    rerender(<TaskCard task={{ ...task, hasUnansweredMention: true }} />);
    expect(screen.getByLabelText(/mention/i)).toBeInTheDocument();
  });
});
