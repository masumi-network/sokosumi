import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { Task } from "@/lib/clients/generated/core/types.gen";

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

const { removeTaskParticipantMock } = vi.hoisted(() => ({
  removeTaskParticipantMock: vi.fn(),
}));

vi.mock("@/lib/actions/task/action", () => ({
  removeTaskParticipant: removeTaskParticipantMock,
  setTaskStatusFromDrag: vi.fn(),
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

const baseLabels = {
  visibility: "Visibility",
  privateBadge: "Private",
  status: "Status",
  statusLabels: baseStatusLabels,
  owner: "Owner",
  creator: "Creator",
  organization: "Organization",
  personalWorkspace: "Personal",
  project: "Project",
  schedule: "Schedule",
  coworker: "Coworker",
  credits: "Credits",
  created: "Created",
  updated: "Updated",
  participants: "Participants",
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
    visibility?: TaskMetadataTask["visibility"];
    selectableStatuses?: TaskMetadataTask["selectableStatuses"];
    participants?: TaskMetadataTask["participants"];
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
    visibility: overrides.visibility,
    selectableStatuses: overrides.selectableStatuses ?? [],
    owner: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
    creator,
    organization: null,
    assignee,
    participants: overrides.participants ?? [],
    credits: overrides.credits ?? 0,
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
      canRemoveParticipants={false}
      task={task}
      project={null}
      createdAtLabel="Jul 16, 10:28 AM"
      updatedAtLabel="Jul 16, 10:29 AM"
      creditsDisplay={String(task.credits)}
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

  it("shows visibility as the first property when the task is private", () => {
    renderTaskMetadata({
      task: createTask({ visibility: "PRIVATE" }),
    });

    const visibility = screen.getByText("Visibility");
    const status = screen.getByText("Status");
    expect(
      visibility.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("hides visibility when the task is public", () => {
    renderTaskMetadata({ task: createTask({ visibility: "PUBLIC" }) });

    expect(screen.queryByText("Visibility")).not.toBeInTheDocument();
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("shows credits after coworker when task has charged credits", () => {
    renderTaskMetadata({ task: createTask({ credits: 12 }) });

    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByText("Credits")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders the locale-formatted credits display string", () => {
    renderTaskMetadata({
      task: createTask({ credits: 1500 }),
      creditsDisplay: "1,500",
    });

    expect(screen.getByText("1,500")).toBeInTheDocument();
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
      "bg-status-working-quaternary",
      "rounded-sm",
      "px-2.5",
      "py-1",
      "text-xs",
    );
    expect(pill?.textContent).toContain("Running");
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

    await user.click(screen.getByRole("combobox", { name: "Draft" }));

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

    await user.click(screen.getByRole("combobox", { name: "Failed" }));

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Failed/ })).toHaveAttribute(
      "data-current",
      "true",
    );
  });
});

function taskParticipant(id: string, name: string) {
  return {
    user: { id, name, image: null },
    addedAt: new Date("2026-07-16T10:00:00.000Z"),
  };
}

describe("TaskMetadata participants", () => {
  const people = ["Ada", "Bea", "Cy", "Dee", "Eve"].map((name) =>
    taskParticipant(`user-${name}`, name),
  );

  it("keeps owner and assignee rows and lists every participant", () => {
    renderTaskMetadata({ task: createTask({ participants: people }) });

    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByText("Hepha")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Participants" });
    expect(
      Array.from(list.querySelectorAll("li")).map((item) => item.textContent),
    ).toEqual(["AAda", "BBea", "CCy", "DDee", "EEve"]);
  });

  it("shows an empty Participants row when nobody was mentioned", () => {
    renderTaskMetadata({ task: createTask() });

    expect(screen.queryByRole("list", { name: "Participants" })).toBeNull();
    expect(screen.getByText("Participants").parentElement).toHaveTextContent(
      "Participants—",
    );
  });

  it("hides remove buttons when the viewer cannot comment", () => {
    renderTaskMetadata({ task: createTask({ participants: people }) });

    expect(
      screen.queryByRole("button", { name: "removeParticipant:Ada" }),
    ).toBeNull();
  });

  it("removes a participant after confirmation", async () => {
    removeTaskParticipantMock.mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", userId: "user-Bea" },
    });
    renderTaskMetadata({
      task: createTask({ participants: people }),
      canRemoveParticipants: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "removeParticipant:Bea" }),
    );

    expect(removeTaskParticipantMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "removeParticipantConfirmTitle:Bea",
      }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "removeParticipant:Bea",
      }),
    );

    expect(removeTaskParticipantMock).toHaveBeenCalledWith({
      taskId: "task-1",
      userId: "user-Bea",
    });
  });

  it("keeps the participant when remove confirmation is cancelled", async () => {
    renderTaskMetadata({
      task: createTask({ participants: people }),
      canRemoveParticipants: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "removeParticipant:Bea" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(removeTaskParticipantMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "removeParticipant:Bea" }),
    ).toBeInTheDocument();
  });
});
