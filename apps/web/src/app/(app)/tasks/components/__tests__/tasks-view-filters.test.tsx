import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const filterDropdownMenuMock = vi.fn();

vi.mock("@/components/common/filter-dropdown-menu", () => ({
  FilterDropdownMenu: (props: unknown) => {
    filterDropdownMenuMock(props);
    return <div data-testid="filter-dropdown-menu" />;
  },
}));

import { TasksViewFilters } from "../tasks-view-filters";

const labels = {
  all: "All",
  title: "Filters",
  member: "Member",
  memberMe: "Me",
  coworker: "Coworker",
  agent: "Agent",
  taskStatus: "Task status",
  jobStatus: "Job status",
  searchPlaceholder: "Filter...",
  emptyResults: "No results found.",
  taskStatusOptions: {
    DRAFT: "Draft",
    READY: "Ready",
    INPUT_REQUIRED: "Input required",
    AUTHENTICATION_REQUIRED: "Authentication required",
    OUT_OF_CREDITS: "Out of credits",
    CREDITS_TOPPED_UP: "Credits topped up",
    RUNNING: "Running",
    AWAITING_EXTERNAL: "Awaiting external",
    COMPLETED: "Completed",
    FAILED: "Failed",
    CANCEL_REQUESTED: "Cancel requested",
    CANCELED: "Canceled",
  },
  jobStatusOptions: {
    INITIATED: "Initiated",
    AWAITING_PAYMENT: "Awaiting payment",
    AWAITING_INPUT: "Awaiting input",
    RUNNING: "Running",
    COMPLETED: "Completed",
    FAILED: "Failed",
  },
} as const;

function renderTasksViewFilters(activeTab: "tasks" | "jobs") {
  render(
    <TasksViewFilters
      activeTab={activeTab}
      memberOptions={[
        {
          id: "member-1",
          name: "Alice",
          image: null,
        },
      ]}
      coworkerOptions={[
        {
          id: "coworker-1",
          slug: "elena",
          name: "Elena",
          image: "elena.png",
        },
      ]}
      agentOptions={[
        {
          id: "agent-1",
          name: "Research Agent",
          image: "agent.png",
        },
      ]}
      memberId={null}
      coworkerId={null}
      agentId={null}
      taskStatus={null}
      jobStatus={null}
      onMemberChange={vi.fn()}
      onCoworkerChange={vi.fn()}
      onAgentChange={vi.fn()}
      onTaskStatusChange={vi.fn()}
      onJobStatusChange={vi.fn()}
      labels={labels}
    />,
  );

  return filterDropdownMenuMock.mock.calls.at(-1)?.[0] as {
    buttonLabel: string;
    sections: Array<{ id: string; label: string }>;
  };
}

describe("TasksViewFilters", () => {
  beforeEach(() => {
    filterDropdownMenuMock.mockClear();
  });

  it("builds tasks tab sections with agent and coworker filters", () => {
    const props = renderTasksViewFilters("tasks");

    expect(props.buttonLabel).toBe("Filters");
    expect(props.sections.map((section) => section.id)).toEqual([
      "member",
      "agent",
      "coworker",
      "task-status",
    ]);
  });

  it("builds jobs tab sections with agent and job status filters", () => {
    const props = renderTasksViewFilters("jobs");

    expect(props.sections.map((section) => section.id)).toEqual([
      "member",
      "agent",
      "job-status",
    ]);
  });
});
