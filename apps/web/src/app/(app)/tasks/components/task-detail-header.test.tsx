import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/task-1",
  useRouter: () => ({
    prefetch: vi.fn(),
    push: vi.fn(),
  }),
}));

describe("TaskDetailHeader", () => {
  it("hides the in-page back control below md and keeps desktop flex layout", () => {
    const { container } = render(
      <TaskDetailHeader
        taskName="Example task"
        backLabel="Back"
        actions={<button type="button">Actions</button>}
      />,
    );

    const row = container.querySelector(".flex.items-center");
    expect(row?.className).toContain("justify-end");
    expect(row?.className).toContain("md:justify-between");

    const back = screen.getByRole("button", { name: "Back" });
    expect(back.className).toContain("hidden");
    expect(back.className).toContain("md:inline-flex");
  });

  it("renders the task name without a private badge", () => {
    render(<TaskDetailHeader taskName="Secret" backLabel="Back" />);

    expect(screen.getByRole("heading", { name: "Secret" })).toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("shows a Markdown task name as plain text", () => {
    render(
      <TaskDetailHeader taskName="**Task Name:** _Weekly_" backLabel="Back" />,
    );

    expect(
      screen.getByRole("heading", { name: "Task Name: Weekly" }),
    ).toBeInTheDocument();
  });
});
