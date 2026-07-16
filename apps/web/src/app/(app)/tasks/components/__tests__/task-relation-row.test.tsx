import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRelationRow } from "@/app/tasks/components/task-relation-row";
import { TaskStatus } from "@/lib/clients/generated/core";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: vi.fn(),
  }),
}));

describe("TaskRelationRow", () => {
  it("renders the relation icon even when the translated label is missing", () => {
    render(
      <TaskRelationRow
        taskId="task-2"
        taskName="Dependency cleanup"
        taskStatus={TaskStatus.READY}
        relation="blocked_by"
      />,
    );

    expect(screen.getByLabelText("Blocked by")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Dependency cleanup/i }),
    ).toHaveAttribute("href", "/tasks/task-2");
  });
});
