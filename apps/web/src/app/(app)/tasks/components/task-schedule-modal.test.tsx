import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Stateful stand-in: seeds its draft from initialSelection on mount only, so
// the draft resets only when the modal remounts the section.
vi.mock("@/components/task-schedule-section", () => ({
  TaskScheduleSection: ({
    initialSelection,
    onSave,
    onCancel,
    onClearSchedule,
  }: {
    initialSelection: TaskScheduleSelection;
    onSave: (selection: TaskScheduleSelection) => void;
    onCancel: () => void;
    onClearSchedule: () => void;
  }) => {
    const [draft, setDraft] = useState(initialSelection);

    return (
      <div>
        <div data-testid="schedule-mode">{draft.mode}</div>
        <button
          type="button"
          onClick={() => setDraft({ ...draft, mode: "recurring" })}
        >
          edit
        </button>
        <button type="button" onClick={() => onSave(draft)}>
          save
        </button>
        <button type="button" onClick={onCancel}>
          cancel
        </button>
        <button type="button" onClick={onClearSchedule}>
          clear
        </button>
      </div>
    );
  },
}));

import { TaskScheduleModal } from "./task-schedule-modal";

const onceUtc: TaskScheduleSelection = {
  mode: "once",
  timezone: "UTC",
  oneTimeLocalIso: "2030-01-02T09:00",
};

const noneUtc: TaskScheduleSelection = {
  mode: "none",
  timezone: "UTC",
};

function buildModal({
  open = true,
  initialSelection = onceUtc,
  onOpenChange = vi.fn(),
  onApply = vi.fn(),
  onClearSchedule = vi.fn(),
}: {
  open?: boolean;
  initialSelection?: TaskScheduleSelection;
  onOpenChange?: (open: boolean) => void;
  onApply?: (selection: TaskScheduleSelection) => void;
  onClearSchedule?: () => void;
} = {}) {
  return (
    <TaskScheduleModal
      open={open}
      onOpenChange={onOpenChange}
      initialSelection={initialSelection}
      onApply={onApply}
      onClearSchedule={onClearSchedule}
    />
  );
}

describe("TaskScheduleModal", () => {
  it("resets an edited draft when initialSelection changes while open", async () => {
    const user = userEvent.setup();
    const { rerender } = render(buildModal());

    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("recurring");

    rerender(buildModal({ initialSelection: noneUtc }));

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("none");
  });

  it("resets an edited draft when the modal is closed and reopened", async () => {
    const user = userEvent.setup();
    const { rerender } = render(buildModal());

    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("recurring");

    rerender(buildModal({ open: false }));
    expect(screen.queryByTestId("schedule-mode")).not.toBeInTheDocument();

    rerender(buildModal());

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("once");
  });

  it("keeps an edited draft when the parent re-renders with the same initialSelection", async () => {
    const user = userEvent.setup();
    const { rerender } = render(buildModal());

    await user.click(screen.getByRole("button", { name: "edit" }));
    rerender(buildModal());

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("recurring");
  });

  it("applies the edited selection and closes the modal", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(buildModal({ onApply, onOpenChange }));

    await user.click(screen.getByRole("button", { name: "edit" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(onApply).toHaveBeenCalledWith({ ...onceUtc, mode: "recurring" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clears the schedule and closes the modal", async () => {
    const user = userEvent.setup();
    const onClearSchedule = vi.fn();
    const onOpenChange = vi.fn();

    render(buildModal({ onClearSchedule, onOpenChange }));

    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(onClearSchedule).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
