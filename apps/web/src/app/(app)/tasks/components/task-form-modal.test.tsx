import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

import {
  isTaskFormPortalEventTarget,
  TaskFormModal,
  TaskFormModalHeaderStart,
} from "./task-form-modal";

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
      screen.getByRole("dialog", { name: "What should Elena do?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "What should Elena do?" }),
    ).toBeInTheDocument();
  });

  it("renders, updates, and clears TaskFormModalHeaderStart across rerenders, StrictMode, and Activity reveal", () => {
    const onBack = vi.fn();

    function ModalHarness({
      showBack,
      disabled = false,
    }: {
      showBack: boolean;
      disabled?: boolean;
    }) {
      return (
        <TaskFormModal
          open
          onOpenChange={vi.fn()}
          title="Create task"
          cancelLabel="Cancel"
        >
          {showBack ? (
            <TaskFormModalHeaderStart>
              <button type="button" disabled={disabled} onClick={onBack}>
                Back
              </button>
            </TaskFormModalHeaderStart>
          ) : null}
          <div>Body</div>
        </TaskFormModal>
      );
    }

    const { rerender } = render(
      <StrictMode>
        <Activity mode="visible">
          <ModalHarness showBack />
        </Activity>
      </StrictMode>,
    );

    const backButton = screen.getByRole("button", { name: "Back" });
    expect(backButton).toBeEnabled();
    fireEvent.click(backButton);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Updating children updates the header slot without unmounting the modal.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ModalHarness showBack disabled />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    // Hiding and revealing Activity restores the header start control cleanly.
    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ModalHarness showBack />
        </Activity>
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ModalHarness showBack />
        </Activity>
      </StrictMode>,
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();

    // Unmounting TaskFormModalHeaderStart removes it from the header slot.
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ModalHarness showBack={false} />
        </Activity>
      </StrictMode>,
    );
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });
});
