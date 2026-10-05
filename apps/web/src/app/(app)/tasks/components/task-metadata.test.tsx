import { TaskPriority, TaskStatus } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showCalendarClientUpgradeModal: vi.fn(),
  }),
}));

const setTaskPriorityMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/task/action", () => ({
  setTaskStatusFromDrag: vi.fn(),
  setTaskPriority: setTaskPriorityMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: ({ seed, alt }: { seed: string | null; alt?: string }) => (
    <div data-testid="assistant-orb" data-seed={seed ?? ""} aria-label={alt} />
  ),
}));

const baseStatusLabels = {
  [TaskStatus.RUNNING]: "Running",
} as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>;

const baseStatusFieldLabels = {
  status: "Status",
  statusLabels: baseStatusLabels,
  changeStatus: "Change status…",
  noStatusMatches: "No status matches",
  reopenToReadyTitle: "Reopen task",
  reopenToReadyDescription: "Add a comment",
  reopenToReadyCommentLabel: "Comment",
  reopenToReadyCommentPlaceholder: "Describe what still needs to be done",
  reopenToReadyCommentRequired: "A comment is required",
  reopenToReadyConfirm: "Reopen to Ready",
  cancel: "Cancel",
  updateStatusSuccess: "Task status updated",
  updateStatusError: "Failed to update task status",
};

const basePriorityLabels = {
  priority: "Priority",
  levels: {
    URGENT: "Urgent",
    HIGH: "High",
    MEDIUM: "Medium",
    LOW: "Low",
    NONE: "No priority",
  },
  changePriority: "Change priority",
  noPriorityMatches: "No priority matches",
  updateError: "Failed to update priority",
};

const baseLabels = {
  privateBadge: "Private",
  status: "Status",
  statusLabels: baseStatusLabels,
  organization: "Organization",
  personalWorkspace: "Personal",
  project: "Project",
  noProject: "No project",
  schedule: "Schedule",
  assignee: "Assignee",
  noAssignee: "No assignee",
  memberFallback: "Member",
  personalAssistantFallback: "Personal assistant",
};

type TaskMetadataTask = ComponentProps<typeof TaskMetadata>["task"];

function createTask(
  overrides: {
    assigneeName?: string | null;
    assignee?: TaskMetadataTask["assignee"];
    status?: TaskMetadataTask["status"];
    visibility?: TaskMetadataTask["visibility"];
    priority?: TaskMetadataTask["priority"];
    organization?: TaskMetadataTask["organization"];
    selectableStatuses?: TaskMetadataTask["selectableStatuses"];
  } = {},
): TaskMetadataTask {
  const assignee: TaskMetadataTask["assignee"] =
    overrides.assignee !== undefined
      ? overrides.assignee
      : overrides.assigneeName === null
        ? null
        : {
            type: "coworker",
            id: "cw_1",
            coworker: {
              id: "cw_1",
              name: overrides.assigneeName ?? "Hepha",
              image: null,
              slug: "hepha",
            },
          };

  return {
    status: overrides.status ?? TaskStatus.RUNNING,
    priority: overrides.priority ?? TaskPriority.NONE,
    visibility: overrides.visibility,
    selectableStatuses: overrides.selectableStatuses ?? [],
    organization: overrides.organization ?? null,
    assignee,
  };
}

function renderTaskMetadata(
  props: Partial<ComponentProps<typeof TaskMetadata>> & {
    task: TaskMetadataTask;
  },
) {
  const { task, ...rest } = props;
  return render(
    <TaskMetadata
      title="Properties"
      taskId="task-1"
      editable={false}
      task={task}
      project={null}
      labels={baseLabels}
      statusFieldLabels={baseStatusFieldLabels}
      priorityLabels={basePriorityLabels}
      {...rest}
    />,
  );
}

describe("TaskMetadata", () => {
  it("renders Properties as a quiet section heading above metadata", () => {
    renderTaskMetadata({ task: createTask() });

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Properties",
    });
    expect(heading).toHaveClass(
      "text-muted-foreground",
      "text-xs",
      "font-medium",
    );
    expect(heading).not.toHaveClass("tracking-wider", "uppercase");
  });

  it("renders rows without left labels, each described as Label: value", () => {
    renderTaskMetadata({ task: createTask() });

    expect(
      screen.getByRole("group", { name: "Status: Running" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Assignee: Hepha" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Organization: Personal" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Project: No project" }),
    ).toBeVisible();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Assignee")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("Project")).not.toBeInTheDocument();
  });

  it("gives every row's leading visual the same fixed slot", () => {
    renderTaskMetadata({
      task: createTask({ visibility: "PRIVATE", assigneeName: null }),
      project: { id: "proj_1", name: "Launch" },
      schedule: <span>Every Monday</span>,
    });

    const rows = screen.getAllByRole("group");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.firstElementChild).toHaveClass(
        "flex",
        "size-5",
        "shrink-0",
        "items-center",
        "justify-center",
      );
    }
  });

  it("has no Owner row", () => {
    renderTaskMetadata({ task: createTask() });

    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /^Owner/ }),
    ).not.toBeInTheDocument();
  });

  it("drops the Creator, Credits, Created and Updated rows", () => {
    renderTaskMetadata({ task: createTask() });

    for (const label of ["Creator", "Credits", "Created", "Updated"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("shows a Private row only when the task is private", () => {
    const { unmount } = renderTaskMetadata({
      task: createTask({ visibility: "PRIVATE" }),
    });

    expect(screen.getByRole("group", { name: "Private" })).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
    unmount();

    renderTaskMetadata({ task: createTask({ visibility: "PUBLIC" }) });
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("shows the organization name when there is one", () => {
    renderTaskMetadata({
      task: createTask({
        organization: { id: "org_1", name: "Masumi", slug: "masumi" },
      }),
    });

    expect(
      screen.getByRole("group", { name: "Organization: Masumi" }),
    ).toBeInTheDocument();
  });

  it("links the project name, or shows a muted No project", () => {
    const { unmount } = renderTaskMetadata({
      task: createTask(),
      project: { id: "proj_1", name: "Launch" },
    });

    expect(screen.getByRole("link", { name: "Launch" })).toHaveAttribute(
      "href",
      "/projects/proj_1",
    );
    expect(screen.queryByText("No project")).not.toBeInTheDocument();
    unmount();

    renderTaskMetadata({ task: createTask() });
    expect(screen.getByText("No project")).toHaveClass("text-muted-foreground");
  });

  it("renders the schedule row only when a schedule node is given", () => {
    const { unmount } = renderTaskMetadata({
      task: createTask(),
      schedule: <span>Every Monday</span>,
    });

    expect(screen.getByText("Every Monday")).toBeInTheDocument();
    unmount();

    renderTaskMetadata({ task: createTask() });
    expect(
      screen.queryByRole("group", { name: /^Schedule/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a muted No assignee when nobody is assigned", () => {
    renderTaskMetadata({ task: createTask({ assigneeName: null }) });

    expect(screen.getByText("No assignee")).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("shows the mascot the bot claimed, not a generated orb", () => {
    // Claimed mascot is the bot's face; the orb is only the fallback.
    renderTaskMetadata({
      task: createTask({
        assignee: {
          type: "sokoBot",
          id: "bot-2",
          sokoBot: {
            id: "bot-2",
            name: "Joseph",
            avatarSeed: null,
            avatarImageUrl: "https://blob.example/cat.png",
            owner: { id: "user_2", name: "Ada Lovelace", image: null },
          },
        },
      }),
    });

    expect(screen.queryByTestId("assistant-orb")).not.toBeInTheDocument();
    expect(screen.getByText("Joseph")).toBeInTheDocument();
  });

  it("renders an sokoBot assignee with the assistant orb", () => {
    renderTaskMetadata({
      task: createTask({
        assignee: {
          type: "sokoBot",
          id: "bot-1",
          sokoBot: {
            id: "bot-1",
            name: "Jarvis",
            avatarSeed: null,
            avatarImageUrl: null,
            owner: { id: "user_1", name: "Andreas Osberghaus", image: null },
          },
        },
      }),
    });

    expect(screen.getByText("Jarvis")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-orb")).toBeInTheDocument();
  });

  it("renders a user assignee by name (SOK-868)", () => {
    renderTaskMetadata({
      task: createTask({
        assignee: {
          type: "user",
          id: "user_2",
          user: { id: "user_2", name: "Bob", image: null },
        },
      }),
    });

    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("falls back to Member for a blank user assignee name (SOK-868)", () => {
    renderTaskMetadata({
      task: createTask({
        assignee: {
          type: "user",
          id: "user_2",
          user: { id: "user_2", name: "   ", image: null },
        },
      }),
    });

    expect(screen.getByText("Member")).toBeInTheDocument();
  });

  it("renders an inline status select when editable", async () => {
    const user = userEvent.setup();
    const statusLabels = {
      ...baseStatusLabels,
      [TaskStatus.DRAFT]: "Draft",
      [TaskStatus.READY]: "Ready",
      [TaskStatus.COMPLETED]: "Completed",
    } as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>;

    renderTaskMetadata({
      task: createTask(),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    const trigger = screen.getByRole("combobox", { name: "Status: Running" });
    expect(trigger).toHaveClass(
      "h-8",
      "w-[calc(100%+1rem)]",
      "justify-start",
      "px-2",
    );
    expect(trigger).toHaveTextContent("Running");
    // A quiet row, not the coloured pill.
    expect(trigger.querySelector("span.inline-flex")).toBeNull();
    expect(trigger.firstElementChild).toHaveClass("size-5", "justify-center");
    expect(trigger.querySelector("svg.lucide-chevron-down")).toBeNull();

    await user.hover(trigger);
    expect(
      await screen.findByRole("tooltip", { name: "Status: Running" }),
    ).toBeInTheDocument();
  });

  it("offers only the statuses Core marked selectable, in display order", async () => {
    const user = userEvent.setup();

    const statusLabels = {
      ...baseStatusLabels,
      [TaskStatus.DRAFT]: "Draft",
      [TaskStatus.READY]: "Ready",
      [TaskStatus.CANCELED]: "Canceled",
      [TaskStatus.GRANT_PENDING]: "Grant pending",
    };

    renderTaskMetadata({
      task: createTask({
        status: TaskStatus.DRAFT,
        selectableStatuses: [TaskStatus.CANCELED, TaskStatus.READY],
      }),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    await user.click(screen.getByRole("combobox", { name: "Status: Draft" }));

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Draft1", "Ready2", "Canceled3"]);
    expect(
      screen.queryByRole("option", { name: /Grant pending/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the current status visible when Core offers nothing to move to", async () => {
    const user = userEvent.setup();

    const statusLabels = { ...baseStatusLabels, [TaskStatus.FAILED]: "Failed" };

    renderTaskMetadata({
      task: createTask({ status: TaskStatus.FAILED, selectableStatuses: [] }),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    await user.click(screen.getByRole("combobox", { name: "Status: Failed" }));

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Failed/ })).toHaveAttribute(
      "data-current",
      "true",
    );
  });
});

describe("TaskMetadata priority", () => {
  it("puts Priority directly under Status", () => {
    renderTaskMetadata({ task: createTask({ priority: TaskPriority.HIGH }) });

    const rows = screen.getAllByRole("group");
    expect(rows[0]).toHaveAccessibleName("Status: Running");
    expect(rows[1]).toHaveAccessibleName("Priority: High");
    expect(within(rows[1] as HTMLElement).getByText("High")).toBeVisible();
  });

  it("shows a muted No priority for NONE when read-only", () => {
    renderTaskMetadata({ task: createTask() });

    expect(
      screen.getByRole("group", { name: "Priority: No priority" }),
    ).toBeVisible();
    expect(screen.getByText("No priority")).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("shows a Priority tooltip on the editable row", async () => {
    const user = userEvent.setup();
    renderTaskMetadata({ task: createTask(), editable: true });

    await user.hover(
      screen.getByRole("combobox", { name: "Priority: No priority" }),
    );
    expect(
      await screen.findByRole("tooltip", { name: "Priority: No priority" }),
    ).toBeInTheDocument();
  });

  it("offers the levels in order and saves the choice optimistically", async () => {
    const user = userEvent.setup();
    setTaskPriorityMock.mockResolvedValue({ ok: true, value: { taskId: "t" } });

    renderTaskMetadata({ task: createTask(), editable: true });

    await user.click(
      screen.getByRole("combobox", { name: "Priority: No priority" }),
    );
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);

    await user.click(screen.getByRole("option", { name: "Urgent" }));

    expect(setTaskPriorityMock).toHaveBeenCalledWith({
      taskId: "task-1",
      priority: TaskPriority.URGENT,
    });
    expect(
      screen.getByRole("combobox", { name: "Priority: Urgent" }),
    ).toBeInTheDocument();
  });

  it("rolls back and reports when saving fails", async () => {
    const user = userEvent.setup();
    setTaskPriorityMock.mockResolvedValue({
      ok: false,
      error: { kind: "unknown" },
    });

    renderTaskMetadata({
      task: createTask({ priority: TaskPriority.LOW }),
      editable: true,
    });

    await user.click(screen.getByRole("combobox", { name: "Priority: Low" }));
    await user.click(screen.getByRole("option", { name: "High" }));

    expect(
      await screen.findByRole("combobox", { name: "Priority: Low" }),
    ).toBeInTheDocument();
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith("Failed to update priority");
  });

  it("does not call Core when the same level is picked", async () => {
    const user = userEvent.setup();
    setTaskPriorityMock.mockClear();

    renderTaskMetadata({
      task: createTask({ priority: TaskPriority.LOW }),
      editable: true,
    });

    await user.click(screen.getByRole("combobox", { name: "Priority: Low" }));
    await user.click(screen.getByRole("option", { name: "Low" }));

    expect(setTaskPriorityMock).not.toHaveBeenCalled();
  });
});

describe("TaskMetadata participants", () => {
  it("keeps the assignee row and drops the Participants row", () => {
    renderTaskMetadata({ task: createTask() });

    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.getByText("Hepha")).toBeInTheDocument();
    expect(screen.queryByText("Participants")).toBeNull();
  });
});
