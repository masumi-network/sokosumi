import { TaskStatus } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TASK_HOVER_DWELL_MS } from "@/app/tasks/components/task-detail-link";
import { TaskRelationRow } from "@/app/tasks/components/task-relation-row";

const prefetchMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: prefetchMock,
  }),
}));

describe("TaskRelationRow", () => {
  // Admin and developer task pages read uncached, so their prefetch carries
  // only the skeleton; a content prefetch would render them for nothing.
  it("prefetches only the shell for a row under another base path", () => {
    prefetchMock.mockClear();
    render(
      <TaskRelationRow
        taskId="task-2"
        taskName="Dependency cleanup"
        taskIdentifier={null}
        taskStatus={TaskStatus.READY}
        statusLabel="Ready"
        hrefBasePath="/admin/tasks"
      />,
    );

    vi.useFakeTimers();
    try {
      fireEvent.pointerEnter(
        screen.getByRole("link", { name: /Dependency cleanup/i }),
        { pointerType: "mouse" },
      );
      vi.advanceTimersByTime(TASK_HOVER_DWELL_MS);
    } finally {
      vi.useRealTimers();
    }

    expect(prefetchMock).toHaveBeenCalledExactlyOnceWith("/admin/tasks/task-2");
  });

  it("links to the task with the status marker in a fixed leading slot", () => {
    render(
      <TaskRelationRow
        taskId="task-2"
        taskName="Dependency cleanup"
        taskIdentifier={null}
        taskStatus={TaskStatus.READY}
        statusLabel="Ready"
      />,
    );

    const link = screen.getByRole("link", { name: /Dependency cleanup/i });
    expect(link).toHaveAttribute("href", "/tasks/task-2");
    expect(link).toHaveClass(
      "h-8",
      "w-[calc(100%+1rem)]",
      "-mx-2",
      "px-2",
      "gap-2",
      "text-sm",
    );
    expect(link.firstElementChild).toHaveClass(
      "flex",
      "size-5",
      "shrink-0",
      "items-center",
      "justify-center",
    );
    expect(screen.getByRole("img", { name: "Ready" })).toBeInTheDocument();
    expect(screen.getByText("Dependency cleanup")).toHaveClass("truncate");
  });

  it("links with the identifier slug URL when the peer has an identifier", () => {
    render(
      <TaskRelationRow
        taskId="task-2"
        taskName="Dependency cleanup"
        taskIdentifier="SOK-12"
        taskStatus={TaskStatus.READY}
        statusLabel="Ready"
      />,
    );

    expect(
      screen.getByRole("link", { name: /Dependency cleanup/i }),
    ).toHaveAttribute("href", "/tasks/SOK-12-dependency-cleanup");
  });

  it("uses the surface UUID path when hrefBasePath is set, ignoring identifiers", () => {
    render(
      <TaskRelationRow
        taskId="task-2"
        taskName="Dependency cleanup"
        taskIdentifier="SOK-12"
        taskStatus={TaskStatus.READY}
        statusLabel="Ready"
        hrefBasePath="/admin/tasks"
      />,
    );

    expect(
      screen.getByRole("link", { name: /Dependency cleanup/i }),
    ).toHaveAttribute("href", "/admin/tasks/task-2");
  });
});
