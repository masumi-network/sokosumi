import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectTasksSection } from "@/app/projects/components/project-tasks-section";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { TaskListItem } from "@/lib/clients/generated/core/types.gen";

const { refreshMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/lib/actions/project/action", () => ({
  addProjectTask: vi.fn(),
  removeProjectTask: vi.fn(),
}));

vi.mock("@/app/projects/components/project-task-picker-dialog", () => ({
  ProjectTaskPickerDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="task-picker">Picker</div> : null,
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: () => <span>2h ago</span>,
}));

const labels = {
  title: "Tasks",
  empty: "No tasks linked to this project yet.",
  add: "Add task",
  viewAll: "View all",
  pickerTitle: "Add task",
  pickerDescription: "Choose an unassigned task.",
  pickerSearchPlaceholder: "Search tasks...",
  pickerEmpty: "No unassigned tasks found.",
  pickerLoading: "Loading tasks...",
  pickerError: "Failed to load tasks.",
  errors: {
    add: "Couldn't add task",
  },
};

function buildTask(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: "task-1",
    name: "Ship restyle",
    status: TaskStatus.READY,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
    description: "Make project detail match task detail",
    ...overrides,
  } as TaskListItem;
}

describe("ProjectTasksSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders open-section chrome with view-all and list-row task links", () => {
    render(
      <ProjectTasksSection
        projectId="project-1"
        tasks={[buildTask()]}
        labels={labels}
      />,
    );

    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute(
      "href",
      "/tasks?projectId=project-1",
    );

    const taskLink = screen.getByRole("link", { name: /Ship restyle/ });
    expect(taskLink).toHaveAttribute("href", "/tasks/task-1");
    expect(taskLink.className).toContain("hover:bg-muted/50");
    expect(taskLink.className).not.toMatch(/\bborder\b/);

    const listBox = screen
      .getByTestId("project-tasks-section")
      .querySelector(".bg-muted\\/30");
    expect(listBox?.className).toContain("md:rounded-xl");
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });

  it("shows empty copy and keeps add without row delete chrome", async () => {
    const user = userEvent.setup();
    render(
      <ProjectTasksSection projectId="project-1" tasks={[]} labels={labels} />,
    );

    expect(
      screen.getByText("No tasks linked to this project yet."),
    ).toBeInTheDocument();

    const listBox = screen
      .getByTestId("project-tasks-section")
      .querySelector(".bg-muted\\/30");
    expect(listBox?.className).toContain("md:rounded-xl");
    expect(listBox).toContainElement(
      screen.getByText("No tasks linked to this project yet."),
    );

    await user.click(screen.getByRole("button", { name: "Add task" }));
    expect(screen.getByTestId("task-picker")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
