import { TaskStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRelationRow } from "@/app/tasks/components/task-relation-row";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
  }),
}));

describe("TaskRelationRow", () => {
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
    expect(link).toHaveClass("h-8", "gap-2", "text-sm");
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
