import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskDetailHeader } from "@/app/tasks/components/task-detail-header";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

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

  describe("task identifier", () => {
    const identifierLabels = {
      copy: "Copy task ID",
      copied: "Copied SOK-12",
      copyError: "Could not copy",
    };

    it("shows the identifier as quiet text above the title", () => {
      render(
        <TaskDetailHeader
          taskName="Fix login"
          identifier="SOK-12"
          identifierLabels={identifierLabels}
          backLabel="Back"
        />,
      );

      const identifier = screen.getByRole("button", {
        name: "Copy task ID: SOK-12",
      });
      expect(identifier).toHaveTextContent("SOK-12");
      expect(identifier).toHaveClass("text-muted-foreground", "tabular-nums");
    });

    it("copies the identifier and confirms with a toast", async () => {
      const user = userEvent.setup();
      const writeText = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      render(
        <TaskDetailHeader
          taskName="Fix login"
          identifier="SOK-12"
          identifierLabels={identifierLabels}
          backLabel="Back"
        />,
      );

      await user.click(screen.getByRole("button", { name: /SOK-12/ }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith("SOK-12"));
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied SOK-12");
    });

    it("reports a clipboard failure", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
        new Error("denied"),
      );
      render(
        <TaskDetailHeader
          taskName="Fix login"
          identifier="SOK-12"
          identifierLabels={identifierLabels}
          backLabel="Back"
        />,
      );

      await user.click(screen.getByRole("button", { name: /SOK-12/ }));

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith("Could not copy"),
      );
    });

    it("renders no identifier for a task without a project", () => {
      render(
        <TaskDetailHeader
          taskName="Loose task"
          identifier={null}
          identifierLabels={identifierLabels}
          backLabel="Back"
        />,
      );

      expect(
        screen.queryByRole("button", { name: /Copy task ID/ }),
      ).not.toBeInTheDocument();
    });
  });
});
