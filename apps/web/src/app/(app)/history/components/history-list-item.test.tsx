import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHistoryItemHref,
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import { getHistoryRowSubtitle } from "@/app/history/utils/history-row-subtitle";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { HistoryItem } from "@/lib/services/history.service";

const iconMocks = vi.hoisted(() => ({
  agentIcon: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: (props: {
    agent: { name: string; icon: string | null };
    className?: string;
  }) => {
    iconMocks.agentIcon(props);
    return <span data-testid="agent-icon" />;
  },
}));

const labels: HistoryListItemLabels = {
  credit: "credit",
  credits: "credits",
  creditsUnavailable: "—",
  noDescription: "No description",
  updated: "Updated",
  kind: {
    task: "Task",
    job: "Job",
  },
  taskStatus: {
    [TaskStatus.DRAFT]: "Entwurf",
    [TaskStatus.QUEUED]: "In Warteschlange",
    [TaskStatus.READY]: "Bereit",
    [TaskStatus.GRANT_PENDING]: "Freigabe ausstehend",
    [TaskStatus.INPUT_REQUIRED]: "Eingabe erforderlich",
    [TaskStatus.APPROVAL_REQUIRED]: "Genehmigung erforderlich",
    [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentifizierung erforderlich",
    [TaskStatus.OUT_OF_CREDITS]: "Keine Credits mehr",
    [TaskStatus.CREDITS_TOPPED_UP]: "Credits aufgeladen",
    [TaskStatus.RUNNING]: "Läuft",
    [TaskStatus.AWAITING_EXTERNAL]: "Wartet auf Externes",
    [TaskStatus.COMPLETED]: "Abgeschlossen",
    [TaskStatus.FAILED]: "Fehlgeschlagen",
    [TaskStatus.CANCELED]: "Abgebrochen",
  },
};

describe("HistoryListItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders localized task status labels instead of TaskStatusBadge defaults", () => {
    const item: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: null,
      status: TaskStatus.READY,
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Bereit")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });

  it("renders when updatedAt is an ISO string from the server boundary", () => {
    const item = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: null,
      status: "READY",
      updatedAt: "2026-02-19T10:00:00.000Z",
      archivedAt: null,
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    } as unknown as HistoryItem;

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      "2026-02-19T10:00:00.000Z",
    );
  });

  it("links non-archived task rows", () => {
    const item: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: null,
      status: TaskStatus.READY,
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute("href", "/tasks/task-1");
  });

  it("renders archived task rows without a link", () => {
    const item: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Archived task",
      description: null,
      status: TaskStatus.COMPLETED,
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: new Date("2026-02-20T10:00:00.000Z"),
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Archived task")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("builds task and job deep links", () => {
    const task: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: "Audit copy",
      status: "READY",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    };
    const job: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Analyze data",
      description: null,
      status: "completed",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 2,
      projectId: null,
      agentId: "agent-1",
      agentName: null,
      agentIcon: null,
      owner: null,
    };

    expect(getHistoryItemHref(task)).toBe("/tasks/task-1");
    expect(getHistoryItemHref(job)).toBe("/agents/agent-1/jobs/job-1");
  });

  it("uses the agent name as the job fallback subtitle", () => {
    const item: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Analyze data",
      description: null,
      status: "completed",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 2,
      projectId: null,
      agentId: "agent-1",
      agentName: "Research Agent",
      agentIcon: "https://example.com/research.svg",
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Research Agent")).toBeInTheDocument();
    expect(iconMocks.agentIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: {
          name: "Research Agent",
          icon: "https://example.com/research.svg",
        },
      }),
    );
  });

  it("does not repeat the title when the fallback subtitle matches it", () => {
    const item: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Research Agent",
      description: null,
      status: "completed",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 2,
      projectId: null,
      agentId: "agent-1",
      agentName: "Research Agent",
      agentIcon: null,
      owner: null,
    };

    expect(getHistoryRowSubtitle(item, labels)).toBe("No description");
  });

  it("keeps task descriptions and the task no-description fallback unchanged", () => {
    const taskWithDescription: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: "  Audit copy  ",
      status: "READY",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 1,
      projectId: null,
      coworkerId: null,
      orchestratorId: null,
      owner: null,
    };
    const taskWithoutDescription: HistoryItem = {
      ...taskWithDescription,
      description: null,
    };

    expect(getHistoryRowSubtitle(taskWithDescription, labels)).toBe(
      "Audit copy",
    );
    expect(getHistoryRowSubtitle(taskWithoutDescription, labels)).toBe(
      "No description",
    );
  });
});
