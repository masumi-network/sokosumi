import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import { getHistoryItemHref } from "@/app/history/utils/history-item-href";
import { getHistoryRowSubtitle } from "@/app/history/utils/history-row-subtitle";
import { TaskStatus } from "@/lib/clients/generated/core";
import type { HistoryItem } from "@/lib/services/history.service";

const iconMocks = vi.hoisted(() => ({
  agentIcon: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTimeZone: () => "UTC",
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    number: (value: number) => value.toLocaleString("en-US"),
  }),
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
    image: "Image",
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
      sokoBotId: null,
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
      sokoBotId: null,
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
      sokoBotId: null,
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/tasks/task-1");
    expect(link.className.split(/\s+/)).toContain(
      "hover:bg-card-background-hover",
    );
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
      sokoBotId: null,
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
      sokoBotId: null,
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
      sokoBotId: null,
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

  it("groups credit counts through the locale number formatter", () => {
    const item: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: null,
      status: TaskStatus.READY,
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: 1500,
      projectId: null,
      coworkerId: null,
      sokoBotId: null,
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("1,500 credits")).toBeInTheDocument();
  });

  /**
   * A generated image in the feed.
   *
   * Three things are easy to get wrong here and all three cost the reader
   * something: the row must deep-link into Content Studio rather than at a
   * notification destination, it must show the model's readable name rather
   * than Core's search text (which is the raw provider endpoint), and it must
   * not wear a job status badge — an image has no lifecycle of its own.
   */
  describe("an image row", () => {
    const image: HistoryItem = {
      kind: "image",
      id: "asset-9",
      assetId: "asset-9",
      title: "A calm product shot on a light neutral background",
      description: "fal-ai/flux-2-pro \u00b7 3 credits",
      status: "active",
      updatedAt: new Date("2026-09-27T10:00:00.000Z"),
      archivedAt: null,
      credits: 3,
      projectId: "project-7",
      modelLabel: "FLUX.2 Pro",
      owner: null,
    };

    it("opens the studio on that project, with that version selected", () => {
      expect(getHistoryItemHref(image)).toBe(
        "/studio?projectId=project-7&v=asset-9",
      );
    });

    it("falls back to the picker when the row carries no project", () => {
      // The version cannot be shown without a gallery to show it in.
      expect(getHistoryItemHref({ ...image, projectId: null })).toBe("/studio");
    });

    it("names the model, not the provider endpoint", () => {
      // `description` is Core's search text and carries `fal-ai/flux-2-pro`,
      // because SQL cannot read the studio catalog's labels.
      expect(getHistoryRowSubtitle(image, labels)).toBe("FLUX.2 Pro");
    });

    it("shows the prompt, the model, the credits, and no status badge", () => {
      render(
        <HistoryListItem
          item={image}
          labels={labels}
          activeOrganizationId={null}
        />,
      );

      expect(
        screen.getByText("A calm product shot on a light neutral background"),
      ).toBeInTheDocument();
      expect(screen.getByText("FLUX.2 Pro")).toBeInTheDocument();
      expect(screen.getByText("3 credits")).toBeInTheDocument();
      // Never the raw endpoint, and never a job status word. `JobStatusBadge`
      // has no case for "active", so without the image branch in
      // `HistoryStatus` this row wears a badge reading "unknown".
      expect(screen.queryByText(/fal-ai/)).toBeNull();
      expect(screen.queryByText("unknown")).toBeNull();
      // And no coworker avatar: there is no agent behind an image row.
      expect(iconMocks.agentIcon).not.toHaveBeenCalled();
    });

    it("reads a zero-credit row as zero rather than as unknown", () => {
      render(
        <HistoryListItem
          item={{ ...image, credits: 0 }}
          labels={labels}
          activeOrganizationId={null}
        />,
      );

      // Every image that predates charging was backfilled at zero, and zero is
      // a fact about what it cost. `creditsUnavailable` would be a different,
      // weaker claim.
      expect(screen.getByText("0 credits")).toBeInTheDocument();
    });
  });
});
