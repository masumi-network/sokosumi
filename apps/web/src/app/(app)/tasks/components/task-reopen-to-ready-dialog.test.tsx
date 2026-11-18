import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskReopenToReadyDialog } from "./task-reopen-to-ready-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { assignee?: string }) =>
    values?.assignee ? `${key} ${values.assignee}` : key,
}));

function renderDialog(
  props: Partial<Parameters<typeof TaskReopenToReadyDialog>[0]> = {},
) {
  const onOpenChange = vi.fn();
  render(
    <TaskReopenToReadyDialog
      open
      onOpenChange={onOpenChange}
      assigneeName="Writer"
      comment="Need this again"
      onCommentChange={vi.fn()}
      onConfirm={vi.fn()}
      {...props}
    />,
  );
  return { onOpenChange };
}

describe("TaskReopenToReadyDialog", () => {
  it("names the assignee it sends the Task back to", () => {
    renderDialog();

    expect(
      screen.getByRole("heading", { name: "title Writer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "confirm Writer" }),
    ).toBeEnabled();
  });

  it("calls onOpenChange(false) when cancel is clicked while idle", () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores cancel while submit is pending", () => {
    const { onOpenChange } = renderDialog({ isPending: true });

    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the spinner on the draft button while reopening as a draft", () => {
    renderDialog({
      onReopenAsDraft: vi.fn(),
      isPending: true,
      isDraftPending: true,
    });

    expect(
      screen.getByRole("button", { name: "reopenAsDraft" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "confirm Writer" }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("disables confirm when comment is whitespace-only", () => {
    renderDialog({ comment: "   " });

    expect(
      screen.getByRole("button", { name: "confirm Writer" }),
    ).toBeDisabled();
  });

  it("offers Reopen as Draft in place of cancel, with no comment needed", () => {
    const onReopenAsDraft = vi.fn();
    renderDialog({ comment: "", onReopenAsDraft });

    expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "reopenAsDraft" }));
    expect(onReopenAsDraft).toHaveBeenCalledOnce();
  });
});
