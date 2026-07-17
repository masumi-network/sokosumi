import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import { TaskStatus } from "@/lib/clients/generated/core";

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
};

function createTask(
  overrides: { credits?: number; assigneeName?: string | null } = {},
) {
  return {
    status: TaskStatus.RUNNING,
    owner: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
    creatorUserId: "user_1",
    creatorUser: {
      id: "user_1",
      name: "Andreas Osberghaus",
      image: null,
    },
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
});
