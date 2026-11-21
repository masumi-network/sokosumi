import { TaskStatus } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskEditModal } from "./task-edit-modal";

// The App Router as the edit route sees it: Edit links push `/edit` (a new
// bfcacheId for the segment), Cancel and Save replace back to the task page.
const nav = vi.hoisted(() => ({
  pathname: "/tasks/t1/edit",
  bfcacheId: "open-1",
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, bfcacheId: nav.bfcacheId }),
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

function EditRoute({ savedName }: { savedName: string }) {
  // Next hides a route the reader left instead of unmounting it.
  const mode = nav.pathname.endsWith("/edit") ? "visible" : "hidden";
  return (
    <StrictMode>
      <Activity mode={mode}>
        <TaskEditModal
          taskId="t1"
          title="Edit task"
          initialValues={{
            name: savedName,
            description: "Saved details",
            assigneeId: "",
            status: TaskStatus.DRAFT,
            selectableStatuses: [TaskStatus.DRAFT],
          }}
          coworkerOptions={[]}
          projectOptions={[]}
          agentNameById={new Map()}
          labels={{ cancel: "Cancel" } as never}
        />
      </Activity>
    </StrictMode>
  );
}

function reopenEdit(bfcacheId: string) {
  nav.pathname = "/tasks/t1/edit";
  nav.bfcacheId = bfcacheId;
}

beforeEach(() => {
  nav.pathname = "/tasks/t1/edit";
  nav.bfcacheId = "open-1";
  nav.replace.mockImplementation((path: string) => {
    nav.pathname = path;
  });
});

describe("TaskEditModal", () => {
  it("keeps the same field on first open, so typing and focus stay", () => {
    const { rerender } = render(<EditRoute savedName="Saved name" />);
    const field = screen.getByLabelText("Task name");
    field.focus();
    fireEvent.change(field, { target: { value: "Saved name 2" } });

    rerender(<EditRoute savedName="Saved name" />);

    expect(screen.getByLabelText("Task name")).toBe(field);
    expect(field).toHaveValue("Saved name 2");
    expect(field).toHaveFocus();
  });

  it("opens from the saved task after Cancel, not from the cancelled edit", () => {
    const { rerender } = render(<EditRoute savedName="Saved name" />);
    fireEvent.change(screen.getByLabelText("Task name"), {
      target: { value: "Saved name DISCARD" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(nav.replace).toHaveBeenCalledWith("/tasks/t1");
    rerender(<EditRoute savedName="Saved name" />);

    reopenEdit("open-2");
    rerender(<EditRoute savedName="Saved name" />);

    expect(screen.getByLabelText("Task name")).toHaveValue("Saved name");
  });

  it("opens with the name just saved", () => {
    const { rerender } = render(<EditRoute savedName="Old name" />);
    fireEvent.change(screen.getByLabelText("Task name"), {
      target: { value: "New name" },
    });

    // Save closes through the same replace; the route then carries the
    // saved task.
    nav.replace("/tasks/t1");
    rerender(<EditRoute savedName="New name" />);

    reopenEdit("open-2");
    rerender(<EditRoute savedName="New name" />);

    expect(screen.getByLabelText("Task name")).toHaveValue("New name");
  });
});
