import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRunAtModal } from "./task-run-at-modal";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const onApply = vi.fn();
const onClear = vi.fn();
const onClose = vi.fn();

function renderModal(runAt: string | null = null) {
  return render(
    <TaskRunAtModal
      runAt={runAt}
      onApply={onApply}
      onClear={onClear}
      onClose={onClose}
    />,
  );
}

function setInput(value: string) {
  fireEvent.change(screen.getByLabelText("label"), { target: { value } });
}

describe("TaskRunAtModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies a future local time as an ISO string", async () => {
    const user = userEvent.setup();
    renderModal();

    setInput("2030-01-02T09:00");
    await user.click(screen.getByRole("button", { name: "apply" }));

    expect(onApply).toHaveBeenCalledWith(
      new Date("2030-01-02T09:00").toISOString(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects a time that is not in the future", async () => {
    const user = userEvent.setup();
    renderModal();

    setInput("2020-01-02T09:00");
    await user.click(screen.getByRole("button", { name: "apply" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const input = screen.getByLabelText("label");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("notInFuture");
  });

  it("rejects an empty time", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: "apply" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText("notInFuture")).toBeInTheDocument();
  });

  it("starts from the current Run at and offers to clear it", async () => {
    const user = userEvent.setup();
    const runAt = new Date("2030-01-02T09:00").toISOString();
    renderModal(runAt);

    expect(screen.getByLabelText("label")).toHaveValue("2030-01-02T09:00");

    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(onClear).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides clear when no Run at is set", () => {
    renderModal();

    expect(
      screen.queryByRole("button", { name: "clear" }),
    ).not.toBeInTheDocument();
  });

  it("closes without changes on cancel", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("button", { name: "cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });
});
