import { fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

import { isTaskFormPortalEventTarget, TaskFormModal } from "./task-form-modal";

describe("isTaskFormPortalEventTarget", () => {
  it("ignores clicks inside a task-form portal", () => {
    const portal = document.createElement("div");
    portal.setAttribute("data-task-form-portal", "");
    const button = document.createElement("button");
    portal.append(button);
    document.body.append(portal);

    const originalEvent = new PointerEvent("pointerdown", { bubbles: true });
    Object.defineProperty(originalEvent, "target", { value: button });

    expect(isTaskFormPortalEventTarget(originalEvent.target)).toBe(true);
    expect(isTaskFormPortalEventTarget(document.body)).toBe(false);

    portal.remove();
  });
});

describe("TaskFormModal", () => {
  it("stays open when clicking a task-form portal that overflows the dialog", () => {
    const onOpenChange = vi.fn();

    function OverflowingPortalAction() {
      return createPortal(
        <div data-task-form-portal="" className="pointer-events-auto">
          <button type="button">Bold</button>
        </div>,
        document.body,
      );
    }

    render(
      <TaskFormModal
        open
        onOpenChange={onOpenChange}
        title="What should Elena do?"
        cancelLabel="Cancel"
      >
        <OverflowingPortalAction />
      </TaskFormModal>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Bold", hidden: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bold", hidden: true }));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.getByRole("heading", { name: "What should Elena do?" }),
    ).toBeInTheDocument();
  });
});
