import { TaskStatus } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { TaskEditModal } from "./task-edit-modal";

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks/t1/edit",
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("./task-form-modal", () => ({
  TaskFormModal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Holds its own draft, like the real form.
vi.mock("./task-form", () => ({
  TaskForm: ({ initialValues }: { initialValues: { name: string } }) => {
    const [name, setName] = useState(initialValues.name);
    return (
      <input
        aria-label="Task name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
    );
  },
}));

function EditRoute({ mode }: { mode: "visible" | "hidden" }) {
  return (
    <Activity mode={mode}>
      <TaskEditModal
        taskId="t1"
        title="Edit task"
        initialValues={{
          name: "Saved name",
          description: "Saved details",
          assigneeId: "",
          status: TaskStatus.DRAFT,
          selectableStatuses: [TaskStatus.DRAFT],
        }}
        coworkerOptions={[]}
        projectOptions={[]}
        agentNameById={new Map()}
        labels={{} as never}
      />
    </Activity>
  );
}

describe("TaskEditModal", () => {
  it("opens with the saved task, not an edit that was cancelled before", () => {
    // Next keeps a left route mounted but hidden (cacheComponents), so
    // closing the dialog hides the form instead of unmounting it.
    const { rerender } = render(<EditRoute mode="visible" />);
    fireEvent.change(screen.getByLabelText("Task name"), {
      target: { value: "Saved name DISCARD" },
    });

    rerender(<EditRoute mode="hidden" />);
    rerender(<EditRoute mode="visible" />);

    expect(screen.getByLabelText("Task name")).toHaveValue("Saved name");
  });
});
