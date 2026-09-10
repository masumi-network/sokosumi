import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskScheduleSelection } from "@/lib/types/task-schedule";

const sectionMounts: TaskScheduleSelection[] = [];

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

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
    useEffect(() => {
      sectionMounts.push(initialSelection);
    }, [initialSelection]);

    return (
      <div>
        <div data-testid="schedule-mode">{initialSelection.mode}</div>
        <button type="button" onClick={() => onSave(initialSelection)}>
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

describe("TaskScheduleModal", () => {
  beforeEach(() => {
    sectionMounts.length = 0;
  });

  it("resets the schedule body when initialSelection changes while open", () => {
    const { rerender } = render(
      <TaskScheduleModal
        open
        onOpenChange={vi.fn()}
        initialSelection={onceUtc}
        onApply={vi.fn()}
        onClearSchedule={vi.fn()}
      />,
    );

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("once");
    expect(sectionMounts.at(-1)).toEqual(onceUtc);

    rerender(
      <TaskScheduleModal
        open
        onOpenChange={vi.fn()}
        initialSelection={noneUtc}
        onApply={vi.fn()}
        onClearSchedule={vi.fn()}
      />,
    );

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("none");
    expect(sectionMounts.at(-1)).toEqual(noneUtc);
  });

  it("resets the schedule body when the modal is reopened", () => {
    const { rerender } = render(
      <TaskScheduleModal
        open
        onOpenChange={vi.fn()}
        initialSelection={onceUtc}
        onApply={vi.fn()}
        onClearSchedule={vi.fn()}
      />,
    );

    expect(sectionMounts).toHaveLength(1);

    rerender(
      <TaskScheduleModal
        open={false}
        onOpenChange={vi.fn()}
        initialSelection={onceUtc}
        onApply={vi.fn()}
        onClearSchedule={vi.fn()}
      />,
    );

    rerender(
      <TaskScheduleModal
        open
        onOpenChange={vi.fn()}
        initialSelection={onceUtc}
        onApply={vi.fn()}
        onClearSchedule={vi.fn()}
      />,
    );

    expect(screen.getByTestId("schedule-mode")).toHaveTextContent("once");
    expect(sectionMounts.length).toBeGreaterThan(1);
    expect(sectionMounts.at(-1)).toEqual(onceUtc);
  });

  it("applies a selection and closes the modal", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <TaskScheduleModal
        open
        onOpenChange={onOpenChange}
        initialSelection={onceUtc}
        onApply={onApply}
        onClearSchedule={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "save" }));

    expect(onApply).toHaveBeenCalledWith(onceUtc);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clears the schedule and closes the modal", async () => {
    const user = userEvent.setup();
    const onClearSchedule = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <TaskScheduleModal
        open
        onOpenChange={onOpenChange}
        initialSelection={onceUtc}
        onApply={vi.fn()}
        onClearSchedule={onClearSchedule}
      />,
    );

    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(onClearSchedule).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
