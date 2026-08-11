import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";

vi.mock("next/navigation", () => ({
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
});
