import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
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
            id: "cw_1",
            name: overrides.assigneeName ?? "Hepha",
            image: null,
            slug: "hepha",
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
            orchestrator: {
              id: "01960001-0001-7001-8001-000000000099",
              name: "Hermes",
              avatarSeed: null,
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
    expect(screen.getByTestId("assistant-orb")).toHaveAttribute(
      "data-seed",
      "",
    );
  });
});
