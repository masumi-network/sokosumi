import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskReopenToReadyDialog } from "../task-reopen-to-ready-dialog";

const labels = {
  title: "Reopen to Ready",
  description: "Add a comment to reopen this task.",
  commentLabel: "Comment",
  commentPlaceholder: "Why reopen?",
  confirm: "Reopen",
  cancel: "Cancel",
};

describe("TaskReopenToReadyDialog", () => {
  it("calls onOpenChange(false) when cancel is clicked while idle", () => {
    const onOpenChange = vi.fn();

    render(
      <TaskReopenToReadyDialog
        open
        onOpenChange={onOpenChange}
        labels={labels}
        comment="Need this again"
        onCommentChange={vi.fn()}
        onConfirm={vi.fn()}
        isPending={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores cancel while submit is pending", () => {
    const onOpenChange = vi.fn();

    render(
      <TaskReopenToReadyDialog
        open
        onOpenChange={onOpenChange}
        labels={labels}
        comment="Need this again"
        onCommentChange={vi.fn()}
        onConfirm={vi.fn()}
        isPending
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("disables confirm when comment is whitespace-only", () => {
    render(
      <TaskReopenToReadyDialog
        open
        onOpenChange={vi.fn()}
        labels={labels}
        comment="   "
        onCommentChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Reopen" })).toBeDisabled();
  });
});
