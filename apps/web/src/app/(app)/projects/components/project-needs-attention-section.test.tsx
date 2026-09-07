import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProjectNeedsAttentionSection } from "@/app/projects/components/project-needs-attention-section";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { HistoryItem } from "@/lib/services/history.service";

vi.mock("@/components/time-ago", () => ({
  TimeAgo: () => <span>2h ago</span>,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => (
    <span data-testid="job-status">{status}</span>
  ),
}));

vi.mock("@/app/tasks/components/task-status-badge", () => ({
  TaskStatusBadge: ({ label }: { label: string }) => (
    <span data-testid="task-status">{label}</span>
  ),
}));

const labels = {
  needsAttention: "Needs attention",
  empty: "Nothing needs your attention right now.",
  viewAllTasks: "View all tasks",
  viewAllJobs: "View all jobs",
  counts: {
    tasks: "Tasks",
    jobs: "Jobs",
  },
  kind: {
    task: "Task",
    job: "Job",
  },
  taskStatus: {
    [TaskStatus.DRAFT]: "Draft",
    [TaskStatus.QUEUED]: "Queued",
    [TaskStatus.READY]: "Ready",
    [TaskStatus.GRANT_PENDING]: "Grant pending",
    [TaskStatus.INPUT_REQUIRED]: "Input required",
    [TaskStatus.APPROVAL_REQUIRED]: "Approval required",
    [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
    [TaskStatus.OUT_OF_CREDITS]: "Out of credits",
    [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
    [TaskStatus.RUNNING]: "Running",
    [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
    [TaskStatus.COMPLETED]: "Completed",
    [TaskStatus.FAILED]: "Failed",
    [TaskStatus.CANCELED]: "Canceled",
  },
  locale: "en",
};

function buildTaskItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    kind: "task",
    id: "task-1",
    title: "Ship restyle",
    description: null,
    updatedAt: new Date("2026-05-27T10:00:00.000Z"),
    archivedAt: null,
    status: TaskStatus.INPUT_REQUIRED,
    projectId: "project-1",
    ...overrides,
  } as HistoryItem;
}

function buildJobItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    kind: "job",
    id: "job-1",
    title: "Generate assets",
    description: null,
    updatedAt: new Date("2026-05-27T11:00:00.000Z"),
    archivedAt: null,
    status: "payment_failed",
    projectId: "project-1",
    agentId: "agent-1",
    agentName: "Designer",
    ...overrides,
  } as HistoryItem;
}

describe("ProjectNeedsAttentionSection", () => {
  it("renders counts, view-all links, and attention rows", () => {
    render(
      <ProjectNeedsAttentionSection
        projectId="project-1"
        taskCount={4}
        jobCount={2}
        items={[buildTaskItem(), buildJobItem()]}
        labels={labels}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Needs attention" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tasks: 4")).toBeInTheDocument();
    expect(screen.getByLabelText("Jobs: 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "View all tasks" }),
    ).toHaveAttribute("href", "/tasks?projectId=project-1");
    expect(screen.getByRole("link", { name: "View all jobs" })).toHaveAttribute(
      "href",
      "/tasks?projectId=project-1&tab=jobs",
    );

    const taskLink = screen.getByRole("link", { name: /Ship restyle/ });
    expect(taskLink).toHaveAttribute("href", "/tasks/task-1");
    expect(screen.getByTestId("task-status")).toHaveTextContent(
      "Input required",
    );

    const jobLink = screen.getByRole("link", { name: /Generate assets/ });
    expect(jobLink).toHaveAttribute("href", "/agents/agent-1/jobs/job-1");
    expect(screen.getByTestId("job-status")).toHaveTextContent(
      "payment_failed",
    );
  });

  it("shows empty copy when there are no attention items", () => {
    render(
      <ProjectNeedsAttentionSection
        projectId="project-1"
        taskCount={0}
        jobCount={0}
        items={[]}
        labels={labels}
      />,
    );

    expect(
      screen.getByText("Nothing needs your attention right now."),
    ).toBeInTheDocument();
  });
});
