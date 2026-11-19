import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskCreatedCelebration } from "./task-created-celebration";

const hints = {
  DRAFT: "Draft hint",
  QUEUED: "Scheduled hint",
  READY: "Ready hint",
};

describe("TaskCreatedCelebration", () => {
  it.each([
    ["DRAFT", "Draft hint"],
    ["QUEUED", "Scheduled hint"],
    ["READY", "Ready hint"],
  ] as const)("tells what happens next to a %s task", (status, hint) => {
    render(
      <TaskCreatedCelebration
        name="Welcome email"
        status={status}
        statusLabel={status}
        labels={{
          taskCreated: "Task created",
          taskCreatedHint: hints,
          goToTask: "Bring me to the task",
        }}
        onGoToTask={vi.fn()}
      />,
    );

    expect(screen.getByText(hint)).toBeInTheDocument();
    for (const other of Object.values(hints).filter((h) => h !== hint)) {
      expect(screen.queryByText(other)).toBeNull();
    }
  });
});
