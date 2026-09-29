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
  it("shows the privacy icon on the status row for PRIVATE tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PRIVATE)} />);

    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("hides the privacy icon for PUBLIC tasks", () => {
    render(<TaskCard task={buildTask(TaskVisibility.PUBLIC)} />);

    expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
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
    render(<TaskCard task={task} />);
    const project = screen.getByRole("link", { name: "openProject" });
    expect(project).toHaveAttribute("href", "/projects/project-1");
    expect(project.closest('[data-testid="task-detail-link"]')).toBeNull();
    expect(screen.getByText("Long project name")).toBeInTheDocument();
  });
});

describe("TaskCard density", () => {
  it("hides empty metadata in Compact and restores it in Normal", () => {
    const task = buildTask(TaskVisibility.PRIVATE);
    const { rerender } = render(<TaskCard task={task} />);
    const normalClasses = screen.getByRole("article").className;
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-2");

    rerender(<TaskCard task={task} compact />);

    expect(screen.getByRole("article").className).not.toBe(normalClasses);
    expect(screen.getByRole("article")).toHaveClass("p-2", "space-y-1");
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-1");
    expect(screen.getByRole("link", { name: task.name })).toHaveAttribute(
      "href",
      "/tasks/task-1",
    );
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
    expect(screen.queryByText("noProject")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    expect(screen.getByText("Mar 1")).toBeInTheDocument();

    rerender(<TaskCard task={task} compact={false} />);
    expect(screen.getByRole("article").className).toBe(normalClasses);
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("noProject")).toBeInTheDocument();
  });

  it.each([false, true])(
    "hides metadata only in Compact while preserving task and drag controls (compact=%s)",
    (compact) => {
      const onPointerDown = vi.fn();
      const onKeyDown = vi.fn();
      const task: TaskWithCoworker = {
        ...buildTask(TaskVisibility.PUBLIC),
        name: "A long task title that remains available to assistive technology",
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
        runAt: "2030-01-02T09:00:00.000Z",
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
        task.runAt,
      );
      if (compact) {
        expect(
          screen.queryByRole("link", { name: "openProject" }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByText(task.project?.name ?? ""),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: "showAll" }),
        ).not.toBeInTheDocument();
      } else {
        const project = screen.getByRole("link", { name: "openProject" });
        expect(project).toHaveAttribute("title", task.project?.name);
        expect(screen.getByText(task.project?.name ?? "")).toHaveClass(
          "line-clamp-2",
        );
        expect(screen.getByText("vocabulary.design")).toBeInTheDocument();
        const overflow = screen.getByRole("button", { name: "showAll" });
        expect(overflow).toHaveTextContent("+1");
        fireEvent.pointerDown(project);
        fireEvent.keyDown(project, { key: "Enter" });
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
