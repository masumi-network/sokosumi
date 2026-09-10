import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskFormModal } from "./task-form-modal";

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode;
    open?: boolean;
  }) => (
    <div data-testid="dialog" data-open={String(open)}>
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogTitle: () => null,
  DialogDescription: () => null,
}));

const modalProps = {
  title: "New task",
  cancelLabel: "Cancel",
  onOpenChange: () => {},
};

describe("TaskFormModal", () => {
  it("keeps the panel mounted when closed without View Transitions", () => {
    render(
      <TaskFormModal open={false} {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });

  it("mounts the panel while open when View Transitions are on", () => {
    render(
      <TaskFormModal open viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.getByTestId("dialog")).toHaveAttribute("data-open", "true");
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });

  it("unmounts the panel while closed when View Transitions are on", () => {
    render(
      <TaskFormModal open={false} viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.queryByText("New task")).not.toBeInTheDocument();
    expect(screen.queryByText("form")).not.toBeInTheDocument();
  });

  it("keeps the dialog portal open until the exit window ends", async () => {
    const { rerender } = render(
      <TaskFormModal open viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    rerender(
      <TaskFormModal open={false} viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.queryByText("form")).not.toBeInTheDocument();
    expect(screen.getByTestId("dialog")).toHaveAttribute("data-open", "true");

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toHaveAttribute(
        "data-open",
        "false",
      );
    });
  });
});
