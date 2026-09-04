import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { defaultOrbSeed } from "@/lib/aurora-orb";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { Task } from "@/lib/clients/generated/core/types.gen";

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: ({ seed, alt }: { seed: string | null; alt?: string }) => (
    <div data-testid="assistant-orb" data-seed={seed ?? ""} aria-label={alt} />
  ),
}));

const baseLabels = {
  propertiesTitle: "Properties",
  status: "Status",
  statusLabels: {
    [TaskStatus.RUNNING]: "Running",
  } as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>,
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
  formatOrchestratorRole: ({ owner }: { owner: string }) =>
    `${owner}'s personal assistant`,
};

function createTask(
  overrides: {
    credits?: number;
    assigneeName?: string | null;
    creator?: Task["creator"];
  } = {},
) {
  const creator: Task["creator"] = overrides.creator ?? {
    type: "user",
    id: "user_1",
    user: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
  };

  return {
    status: TaskStatus.RUNNING,
    owner: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
    creator,
    organization: null,
    assignee:
      overrides.assigneeName === null
        ? null
        : {
            type: "coworker" as const,
            id: "cw_1",
            coworker: {
              id: "cw_1",
              name: overrides.assigneeName ?? "Hepha",
              image: null,
              slug: "hepha",
            },
          },
    credits: overrides.credits ?? 0,
    metadata: null,
    nextRunAt: null,
  };
}

describe("TaskMetadata", () => {
  it("shows credits after coworker when task has charged credits", () => {
    render(
      <TaskMetadata
        task={createTask({ credits: 12 })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    expect(screen.getByText("Coworker")).toBeInTheDocument();
    expect(screen.getByText("Credits")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("hides credits row when total is zero", () => {
    render(
      <TaskMetadata
        task={createTask({ credits: 0 })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    expect(screen.queryByText("Credits")).not.toBeInTheDocument();
  });

  it("shows coworker creator when different from owner", () => {
    render(
      <TaskMetadata
        task={createTask({
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
        })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Creator Coworker")).toBeInTheDocument();
  });

  it("says whose personal assistant created the task", () => {
    render(
      <TaskMetadata
        task={createTask({
          creator: {
            type: "orchestrator",
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
        })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

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
    render(
      <TaskMetadata
        task={createTask({
          creator: {
            type: "orchestrator",
            id: "01960001-0001-7001-8001-000000000099",
            sokoBot: {
              id: "01960001-0001-7001-8001-000000000099",
              name: "Joseph",
              avatarSeed: null,
              avatarImageUrl: "https://blob.example/cat.png",
              owner: { id: "user_2", name: "Ada Lovelace", image: null },
            },
          },
        })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    // Radix only swaps in the <img> once it loads, which never happens in
    // jsdom, so the regression itself is the assertion: no orb stands in for
    // a bot that has a face of its own.
    expect(screen.queryByTestId("assistant-orb")).not.toBeInTheDocument();
    expect(screen.getByText("Joseph")).toBeInTheDocument();
  });

  it("does not print the role twice when the bot is named after it", () => {
    render(
      <TaskMetadata
        task={createTask({
          creator: {
            type: "orchestrator",
            id: "01960001-0001-7001-8001-000000000099",
            sokoBot: {
              id: "01960001-0001-7001-8001-000000000099",
              name: "Ada Lovelace's personal assistant",
              avatarSeed: null,
              avatarImageUrl: null,
              owner: { id: "user_2", name: "Ada Lovelace", image: null },
            },
          },
        })}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    expect(
      screen.getAllByText("Ada Lovelace's personal assistant"),
    ).toHaveLength(1);
  });

  it("renders an sokoBot assignee with the assistant orb", () => {
    render(
      <TaskMetadata
        task={{
          ...createTask({ assigneeName: null }),
          assignee: {
            type: "orchestrator",
            id: "bot-1",
            sokoBot: {
              id: "bot-1",
              name: "Jarvis",
              avatarSeed: null,
              avatarImageUrl: null,
              owner: { id: "user_1", name: "Andreas Osberghaus", image: null },
            },
          },
        }}
        project={null}
        createdAtLabel="Jul 16, 10:28 AM"
        updatedAtLabel="Jul 16, 10:29 AM"
        labels={baseLabels}
      />,
    );

    expect(screen.getByText("Jarvis")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-orb")).toBeInTheDocument();
  });
});
