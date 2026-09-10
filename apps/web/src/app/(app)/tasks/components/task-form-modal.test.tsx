import { render, screen } from "@testing-library/react";
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
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogTitle: () => null,
  DialogDescription: () => null,
}));

describe("TaskFormModal", () => {
  it("keeps the panel mounted when closed without View Transitions", () => {
    render(
      <TaskFormModal
        open={false}
        onOpenChange={() => {}}
        title="New task"
        cancelLabel="Cancel"
      >
        form
      </TaskFormModal>,
    );

    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });

  it("mounts the panel while open when View Transitions are on", () => {
    render(
      <TaskFormModal
        open
        onOpenChange={() => {}}
        title="New task"
        cancelLabel="Cancel"
        viewTransition
      >
        form
      </TaskFormModal>,
    );

    expect(screen.getByText("New task")).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });

  it("unmounts the panel while closed when View Transitions are on", () => {
    render(
      <TaskFormModal
        open={false}
        onOpenChange={() => {}}
        title="New task"
        cancelLabel="Cancel"
        viewTransition
      >
        form
      </TaskFormModal>,
    );

    expect(screen.queryByText("New task")).not.toBeInTheDocument();
    expect(screen.queryByText("form")).not.toBeInTheDocument();
  });
});
