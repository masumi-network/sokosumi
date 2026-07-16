import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobsListView } from "@/app/tasks/components/jobs-list-view";
import type { TasksViewJob } from "@/app/tasks/types/tasks-view-job";
import { JobType, SokosumiJobStatus } from "@/lib/clients/generated/core";
import type { KanbanColumnId } from "@/lib/types/task";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/jobs/job-status-badge", () => ({
  JobStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("@/components/time-ago", () => ({
  TimeAgo: ({ date }: { date: string | Date }) => (
    <span>{`ago:${date instanceof Date ? date.toISOString() : date}`}</span>
  ),
}));

function createJob(overrides: Partial<TasksViewJob>): TasksViewJob {
  return {
    id: "job-1",
    agentId: overrides.agentId ?? "agent-1",
    name: "Job name",
    createdAt: "2026-02-10T10:00:00.000Z",
    completedAt: null,
    status: SokosumiJobStatus.PROCESSING,
    jobType: JobType.FREE,
    coworker: {
      name: "Jane coworker",
      image: null,
    },
    ...overrides,
  };
}

const labels = {
  recentTitle: "Recent",
  emptyRecent: "No recently finished jobs.",
  emptyList: "No jobs yet.",
  emptySection: "No jobs in this status.",
  untitled: "Untitled job",
  unknownAgent: "Unknown agent",
};

const columnLabels: Record<KanbanColumnId, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  "input-required": "Input Required",
  done: "Done",
};

describe("JobsListView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups jobs by status, keeps newest-first order, applies fallbacks, and isolates recent jobs", async () => {
    window.localStorage.setItem(
      "sokosumi.tasks.jobs.lastSeenAt",
      String(new Date("2026-02-10T12:00:00.000Z").getTime()),
    );

    const jobs: TasksViewJob[] = [
      createJob({
        id: "job-recent-complete",
        name: "Freshly done",
        status: SokosumiJobStatus.COMPLETED,
        createdAt: "2026-02-10T12:30:00.000Z",
        completedAt: "2026-02-10T13:00:00.000Z",
      }),
      createJob({
        id: "job-complete-older",
        name: "Older complete",
        status: SokosumiJobStatus.COMPLETED,
        createdAt: "2026-02-10T11:00:00.000Z",
        completedAt: "2026-02-10T11:30:00.000Z",
      }),
      createJob({
        id: "job-in-progress-new",
        name: "New processing",
        status: SokosumiJobStatus.PROCESSING,
        createdAt: "2026-02-10T10:00:00.000Z",
      }),
      createJob({
        id: "job-in-progress-old",
        name: "Old processing",
        status: SokosumiJobStatus.PROCESSING,
        createdAt: "2026-02-10T09:00:00.000Z",
      }),
      createJob({
        id: "job-input-required",
        name: "Needs input",
        status: SokosumiJobStatus.INPUT_REQUIRED,
        createdAt: "2026-02-10T08:00:00.000Z",
      }),
      createJob({
        id: "job-todo-untitled",
        agentId: "agent-unknown",
        coworker: null,
        name: "   ",
        status: SokosumiJobStatus.STARTED,
        createdAt: "2026-02-10T07:00:00.000Z",
      }),
    ];

    render(
      <JobsListView
        jobs={jobs}
        agentPreviewById={{
          "agent-1": { name: "Agent name", icon: null },
        }}
        columnLabels={columnLabels}
        labels={labels}
      />,
    );

    expect(screen.getByText("Freshly done")).toBeInTheDocument();

    expect(screen.getAllByRole("link", { name: /Freshly done/i })).toHaveLength(
      1,
    );
    expect(screen.getByText("Older complete")).toBeInTheDocument();
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.getByText("Untitled job")).toBeInTheDocument();
    expect(screen.queryByText("Unknown coworker")).not.toBeInTheDocument();
    expect(screen.getAllByText("Agent name").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jane coworker").length).toBeGreaterThan(0);

    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("input_required").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ago:2026-02-10T12:30:00.000Z").length).toBe(2);

    const pageText = screen.getByText("New processing").closest("div");
    expect(pageText).toBeInTheDocument();
    const html = document.body.innerHTML;
    expect(html.indexOf("New processing")).toBeLessThan(
      html.indexOf("Old processing"),
    );
  });

  it("shows failed jobs in the list", () => {
    const jobs: TasksViewJob[] = [
      createJob({
        id: "job-failed",
        name: "Failed one",
        status: SokosumiJobStatus.FAILED,
        createdAt: "2026-02-10T11:00:00.000Z",
        completedAt: "2026-02-10T11:10:00.000Z",
      }),
      createJob({
        id: "job-payment-failed",
        name: "Payment failed one",
        status: SokosumiJobStatus.PAYMENT_FAILED,
        createdAt: "2026-02-10T10:00:00.000Z",
        completedAt: "2026-02-10T10:10:00.000Z",
      }),
    ];

    render(
      <JobsListView
        jobs={jobs}
        agentPreviewById={{
          "agent-1": { name: "Agent name", icon: null },
        }}
        columnLabels={columnLabels}
        labels={labels}
      />,
    );

    expect(screen.getByText("Failed one")).toBeInTheDocument();
    expect(screen.getByText("Payment failed one")).toBeInTheDocument();
  });

  it("includes only COMPLETED jobs in Recent", () => {
    window.localStorage.setItem(
      "sokosumi.tasks.jobs.lastSeenAt",
      String(new Date("2026-02-11T11:59:00.000Z").getTime()),
    );

    const jobs: TasksViewJob[] = [
      createJob({
        id: "job-failed",
        name: "Failed one",
        status: SokosumiJobStatus.FAILED,
        createdAt: "2026-02-11T11:58:00.000Z",
        completedAt: "2026-02-11T11:58:00.000Z",
      }),
      createJob({
        id: "job-completed",
        name: "Completed one",
        status: SokosumiJobStatus.COMPLETED,
        createdAt: "2026-01-01T11:57:00.000Z",
        completedAt: "2026-01-01T11:57:00.000Z",
      }),
    ];

    render(
      <JobsListView
        jobs={jobs}
        agentPreviewById={{
          "agent-1": { name: "Agent name", icon: null },
        }}
        columnLabels={columnLabels}
        labels={labels}
      />,
    );

    expect(screen.queryByText(labels.emptyRecent)).toBeInTheDocument();
    expect(screen.getByText("Failed one")).toBeInTheDocument();
    expect(screen.getByText("Completed one")).toBeInTheDocument();
  });

  it("keeps the first client render aligned with the server render when last-seen storage exists", () => {
    const jobs: TasksViewJob[] = [
      createJob({
        id: "job-fresh-completed",
        name: "Fresh completed job",
        status: SokosumiJobStatus.COMPLETED,
        createdAt: "2026-02-11T11:45:00.000Z",
        completedAt: "2026-02-11T11:50:00.000Z",
      }),
    ];
    const view = (
      <JobsListView
        jobs={jobs}
        agentPreviewById={{
          "agent-1": { name: "Agent name", icon: null },
        }}
        columnLabels={columnLabels}
        labels={labels}
      />
    );
    const originalWindow = globalThis.window;

    try {
      vi.stubGlobal("window", undefined);
      const serverHtml = renderToString(view);

      vi.stubGlobal("window", originalWindow);
      window.localStorage.setItem(
        "sokosumi.tasks.jobs.lastSeenAt",
        String(new Date("2026-02-11T11:55:00.000Z").getTime()),
      );
      const clientHtml = renderToString(view);

      expect(clientHtml).toBe(serverHtml);
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });
});
