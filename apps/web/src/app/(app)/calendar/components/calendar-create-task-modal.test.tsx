import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { createTaskModalMock } = vi.hoisted(() => ({
  createTaskModalMock: vi.fn(),
}));

vi.mock("@/app/tasks/components/create-task-modal", () => ({
  CreateTaskModal: (props: unknown) => {
    createTaskModalMock(props);
    return null;
  },
}));

import { CalendarCreateTaskModal } from "./calendar-create-task-modal";

describe("CalendarCreateTaskModal", () => {
  it("creates through the ordinary Task create, not the Calendar schedule API", () => {
    render(
      <CalendarCreateTaskModal
        coworkerOptions={[]}
        projectOptions={[]}
        lockProjectSelection
      />,
    );

    expect(createTaskModalMock).toHaveBeenCalledWith({
      coworkerOptions: [],
      projectOptions: [],
      lockProjectSelection: true,
    });
  });
});
