import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function mockShellAnimate(finished: Promise<void> = Promise.resolve()) {
  return vi.spyOn(HTMLElement.prototype, "animate").mockReturnValue({
    finished,
    cancel: vi.fn(),
  } as unknown as Animation);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskFormModal", () => {
  it("keeps the panel mounted when closed without View Transitions", () => {
    render(
      <TaskFormModal open={false} {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.getByTestId("dialog")).toHaveAttribute("data-open", "false");
    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });

  it("mounts the dedicated portal while open when View Transitions are on", () => {
    render(
      <TaskFormModal open viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-task-modal-vt")).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "New task" }),
    ).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();

    const overlay = screen.getByTestId("create-task-modal-overlay");
    expect(overlay.className).toContain("bg-background/50");
    expect(overlay.className).toContain("backdrop-blur-lg");
    expect(overlay.className).not.toContain("md:bg-auto");
  });

  it("does not portal when View Transitions start closed", () => {
    render(
      <TaskFormModal open={false} viewTransition {...modalProps}>
        form
      </TaskFormModal>,
    );

    expect(
      screen.queryByTestId("create-task-modal-vt"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("form")).not.toBeInTheDocument();
  });

  it("unmounts the portal when closed", () => {
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

    expect(
      screen.queryByTestId("create-task-modal-vt"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("form")).not.toBeInTheDocument();
  });

  it("dismisses through overlay click and Escape after the shell exit animation", async () => {
    mockShellAnimate();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskFormModal
        open
        viewTransition
        {...modalProps}
        onOpenChange={onOpenChange}
      >
        form
      </TaskFormModal>,
    );

    await user.click(screen.getByTestId("create-task-modal-overlay"));
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    onOpenChange.mockClear();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("animates the live shell before unmounting on dismiss", async () => {
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const animate = mockShellAnimate(finished);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskFormModal
        open
        viewTransition
        {...modalProps}
        onOpenChange={onOpenChange}
      >
        form
      </TaskFormModal>,
    );

    await user.click(screen.getByTestId("create-task-modal-overlay"));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("create-task-modal-vt")).toBeInTheDocument();
    expect(animate).toHaveBeenCalled();
    expect(screen.getByTestId("create-task-modal-vt")).toHaveStyle({
      pointerEvents: "none",
    });

    resolveFinished();
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("does not dismiss from overlay or Escape while dismiss is disabled", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TaskFormModal
        open
        viewTransition
        isDismissDisabled
        {...modalProps}
        onOpenChange={onOpenChange}
      >
        form
      </TaskFormModal>,
    );

    await user.click(screen.getByTestId("create-task-modal-overlay"));
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
