import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { Task } from "@/lib/clients/generated/core/types.gen";
import {
  TASK_STATUS_DISPLAY_ORDER,
  TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT,
} from "@/lib/utils/task-status-order";

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

vi.mock("@/components/task-schedule-display", () => ({
  TaskScheduleDisplay: () => <span>Daily (1:47 PM)</span>,
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
  statusLabels: baseStatusLabels,
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

const baseLabels = {
  status: "Status",
  statusLabels: baseStatusLabels,
  owner: "Owner",
  creator: "Creator",
  organization: "Organization",
  personalWorkspace: "Personal",
  project: "Project",
  coworker: "Coworker",
  credits: "Credits",
  created: "Created",
  updated: "Updated",
  schedule: "Schedule",
  personalAssistantFallback: "Personal assistant",
  formatSokoBotRole: ({ owner }: { owner: string }) =>
    `${owner}'s personal assistant`,
};

type TaskMetadataTask = ComponentProps<typeof TaskMetadata>["task"];

function createTask(
  overrides: {
    credits?: number;
    assigneeName?: string | null;
    assignee?: TaskMetadataTask["assignee"];
    creator?: Task["creator"];
    status?: TaskMetadataTask["status"];
  } = {},
): TaskMetadataTask {
  const creator: Task["creator"] = overrides.creator ?? {
    type: "user",
    id: "user_1",
    user: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
  };

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
    owner: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
    creator,
    organization: null,
    assignee,
    credits: overrides.credits ?? 0,
    metadata: null,
    nextRunAt: null,
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
      createdAtLabel="Jul 16, 10:28 AM"
      updatedAtLabel="Jul 16, 10:29 AM"
      labels={baseLabels}
      statusFieldLabels={baseStatusFieldLabels}
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

  it("shows credits after coworker when task has charged credits", () => {
    renderTaskMetadata({ task: createTask({ credits: 12 }) });

    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByText("Credits")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("hides credits row when total is zero", () => {
    renderTaskMetadata({ task: createTask({ credits: 0 }) });

    expect(screen.queryByText("Credits")).not.toBeInTheDocument();
  });

  it("shows coworker creator when different from owner", () => {
    renderTaskMetadata({
      task: createTask({
        creator: {
          type: "coworker",
          id: "cow_creator",
          coworker: {
            id: "cow_creator",
            name: "Creator Coworker",
            image: null,
            slug: "creator-coworker",
          },
        },
      }),
    });

    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Creator Coworker")).toBeInTheDocument();
  });

  it("says whose personal assistant created the task", () => {
    renderTaskMetadata({
      task: createTask({
        creator: {
          type: "sokoBot",
          id: "01960001-0001-7001-8001-000000000099",
          sokoBot: {
            id: "01960001-0001-7001-8001-000000000099",
            name: "Hermes",
            avatarSeed: null,
            avatarImageUrl: null,
            owner: {
              id: "user_2",
              name: "Ada Lovelace",
              image: null,
            },
          },
        },
      }),
    });

    expect(screen.getByText("Creator")).toBeInTheDocument();
    // The assistant's name reads as a person's, so the role line underneath is
    // the only thing telling the reader what made this Task and for whom.
    expect(screen.getByText("Hermes")).toBeInTheDocument();
    expect(
      screen.getByText("Ada Lovelace's personal assistant"),
    ).toBeInTheDocument();
    // Same fallback the sidebar uses, so the bot wears one face everywhere.
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-seed",
      defaultOrbSeed("user_2"),
    );
  });

  it("shows the mascot the bot claimed, not a generated orb", () => {
    // Claimed mascot is the bot's face; the orb is only the fallback.
    renderTaskMetadata({
      task: createTask({
        creator: {
          type: "sokoBot",
          id: "01960001-0001-7001-8001-000000000099",
          sokoBot: {
            id: "01960001-0001-7001-8001-000000000099",
            name: "Joseph",
            avatarSeed: null,
            avatarImageUrl: "https://blob.example/cat.png",
            owner: { id: "user_2", name: "Ada Lovelace", image: null },
          },
        },
      }),
    });

    // Radix only swaps in the <img> once it loads, which never happens in
    // jsdom, so the regression itself is the assertion: no orb stands in for
    // a bot that has a face of its own.
    expect(screen.queryByTestId("assistant-orb")).not.toBeInTheDocument();
    expect(screen.getByText("Joseph")).toBeInTheDocument();
  });

  it("does not print the role twice when the bot is named after it", () => {
    renderTaskMetadata({
      task: createTask({
        creator: {
          type: "sokoBot",
          id: "01960001-0001-7001-8001-000000000099",
          sokoBot: {
            id: "01960001-0001-7001-8001-000000000099",
            name: "Ada Lovelace's personal assistant",
            avatarSeed: null,
            avatarImageUrl: null,
            owner: { id: "user_2", name: "Ada Lovelace", image: null },
          },
        },
      }),
    });

    expect(
      screen.getAllByText("Ada Lovelace's personal assistant"),
    ).toHaveLength(1);
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

  it("renders an inline status select when editable", () => {
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

    const trigger = screen.getByRole("combobox", { name: "Running" });
    expect(trigger).toBeInTheDocument();

    const pill = trigger.querySelector("span.inline-flex");
    expect(pill).toHaveClass(
      "bg-emerald-500/10",
      "rounded-sm",
      "px-2.5",
      "py-1",
      "text-xs",
    );
    expect(pill?.textContent).toContain("Running");
  });

  const hiddenManualStatusLabels: Partial<Record<TaskStatus, string>> = {
    [TaskStatus.GRANT_PENDING]: "Grant pending",
    [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
    [TaskStatus.OUT_OF_CREDITS]: "Paused: credits needed",
    [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
    [TaskStatus.FAILED]: "Failed",
  };

  function buildStatusLabelsForManualSelectTest(): Record<TaskStatus, string> {
    return Object.fromEntries(
      TASK_STATUS_DISPLAY_ORDER.map((status) => [
        status,
        hiddenManualStatusLabels[status] ??
          (status === TaskStatus.DRAFT
            ? "Draft"
            : status === TaskStatus.QUEUED
              ? "Queued"
              : status === TaskStatus.READY
                ? "Ready"
                : status === TaskStatus.RUNNING
                  ? "Running"
                  : status),
      ]),
    ) as Record<TaskStatus, string>;
  }

  it("hides internal statuses from the manual status dropdown", async () => {
    const user = userEvent.setup();
    const statusLabels = buildStatusLabelsForManualSelectTest();

    renderTaskMetadata({
      task: createTask({ status: TaskStatus.DRAFT }),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    await user.click(screen.getByRole("combobox", { name: "Draft" }));

    for (const status of TASK_STATUSES_HIDDEN_FROM_MANUAL_SELECT) {
      const label = hiddenManualStatusLabels[status];
      if (!label) continue;
      expect(
        screen.queryByRole("option", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("keeps the current hidden status in the dropdown when already set", async () => {
    const user = userEvent.setup();
    const statusLabels = buildStatusLabelsForManualSelectTest();

    renderTaskMetadata({
      task: createTask({ status: TaskStatus.FAILED }),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    expect(
      screen.getByRole("combobox", { name: "Failed" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Failed" }));
    expect(screen.getByRole("option", { name: "Failed" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Grant pending" }),
    ).not.toBeInTheDocument();
  });

  it("disables Queued without a schedule and shows no helper copy (SOK-1033)", async () => {
    const user = userEvent.setup();
    const statusLabels = Object.fromEntries(
      TASK_STATUS_DISPLAY_ORDER.map((status) => [
        status,
        status === TaskStatus.DRAFT
          ? "Draft"
          : status === TaskStatus.QUEUED
            ? "Queued"
            : status === TaskStatus.READY
              ? "Ready"
              : status,
      ]),
    ) as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>;

    renderTaskMetadata({
      task: createTask({ status: TaskStatus.DRAFT }),
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    expect(
      screen.queryByText("Set a schedule before choosing Queued."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Queued is only available for scheduled agent work."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Draft" }));
    expect(screen.getByRole("option", { name: "Queued" })).toHaveAttribute(
      "data-disabled",
    );
  });

  it("enables Queued when an agent task has an active schedule", async () => {
    const user = userEvent.setup();
    const statusLabels = Object.fromEntries(
      TASK_STATUS_DISPLAY_ORDER.map((status) => [
        status,
        status === TaskStatus.DRAFT
          ? "Draft"
          : status === TaskStatus.QUEUED
            ? "Queued"
            : status === TaskStatus.READY
              ? "Ready"
              : status,
      ]),
    ) as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>;

    renderTaskMetadata({
      task: {
        ...createTask({
          status: TaskStatus.READY,
          assignee: {
            type: "coworker",
            id: "coworker-1",
            coworker: {
              id: "coworker-1",
              name: "Elena",
              image: null,
              slug: "elena",
            },
          },
        }),
        metadata: JSON.stringify({
          version: 1,
          mode: "recurring",
          expr: "47 13 * * *",
          timezone: "UTC",
          endsMode: "never",
        }),
      },
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    await user.click(screen.getByRole("combobox", { name: "Ready" }));
    expect(screen.getByRole("option", { name: "Queued" })).not.toHaveAttribute(
      "data-disabled",
    );
  });

  it("disables Queued for a human task even with an active schedule", async () => {
    const user = userEvent.setup();
    const statusLabels = Object.fromEntries(
      TASK_STATUS_DISPLAY_ORDER.map((status) => [
        status,
        status === TaskStatus.DRAFT
          ? "Draft"
          : status === TaskStatus.QUEUED
            ? "Queued"
            : status === TaskStatus.READY
              ? "Ready"
              : status,
      ]),
    ) as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>;

    renderTaskMetadata({
      task: {
        ...createTask({
          status: TaskStatus.READY,
          assignee: {
            type: "user",
            id: "user-1",
            user: {
              id: "user-1",
              name: "Bob",
              image: null,
            },
          },
        }),
        metadata: JSON.stringify({
          version: 1,
          mode: "recurring",
          expr: "47 13 * * *",
          timezone: "UTC",
          endsMode: "never",
        }),
      },
      editable: true,
      labels: { ...baseLabels, statusLabels },
      statusFieldLabels: { ...baseStatusFieldLabels, statusLabels },
    });

    await user.click(screen.getByRole("combobox", { name: "Ready" }));
    expect(screen.getByRole("option", { name: "Queued" })).toHaveAttribute(
      "data-disabled",
    );
  });
});
