import { TaskStatus } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getHistoryItemHref,
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import {
  createEmptyHistoryBucketLookups,
  getHistoryRowSubtitle,
  type HistoryBucketLookups,
} from "@/app/history/utils/history-row-subtitle";
import type { HistoryItem } from "@/lib/services/history.service";

const iconMocks = vi.hoisted(() => ({
  agentIcon: vi.fn(),
  chatModelIcon: vi.fn(),
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

vi.mock("@/components/chat/chat-model-icon", () => ({
  ChatModelIcon: (props: {
    modelId: string;
    modelName?: string;
    className?: string;
    size?: number;
  }) => {
    iconMocks.chatModelIcon(props);
    return <span data-testid="chat-model-icon" />;
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
    conversation: "Chat",
  },
  conversationStatus: {
    active: "Active",
    archived: "Archived",
  },
  taskStatus: {
    [TaskStatus.DRAFT]: "Entwurf",
    [TaskStatus.READY]: "Bereit",
    [TaskStatus.INPUT_REQUIRED]: "Eingabe erforderlich",
    [TaskStatus.APPROVAL_REQUIRED]: "Genehmigung erforderlich",
    [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentifizierung erforderlich",
    [TaskStatus.OUT_OF_CREDITS]: "Keine Credits mehr",
    [TaskStatus.CREDITS_TOPPED_UP]: "Credits aufgeladen",
    [TaskStatus.RUNNING]: "Läuft",
    [TaskStatus.AWAITING_EXTERNAL]: "Wartet auf Externes",
    [TaskStatus.COMPLETED]: "Abgeschlossen",
    [TaskStatus.FAILED]: "Fehlgeschlagen",
    [TaskStatus.CANCEL_REQUESTED]: "Abbruch angefordert",
    [TaskStatus.CANCELED]: "Abgebrochen",
  },
};

const bucketLookups: HistoryBucketLookups = {
  bucketDisplayNameBySlug: {
    hannah: "Hannah",
    "gpt-5-4": "GPT-5.4",
  },
  bucketIconBySlug: {
    hannah: {
      kind: "coworker",
      name: "Hannah",
      imageUrl: "/images/coworkers/hannah.webp",
    },
    "gpt-5-4": {
      kind: "model",
      modelId: "gpt-5-4",
      modelName: "GPT-5.4",
    },
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
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
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
      owner: null,
    } as unknown as HistoryItem;

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByRole("time")).toHaveAttribute(
      "dateTime",
      "2026-02-19T10:00:00.000Z",
    );
  });

  it("renders an em dash for conversation credits and links to the conversation", () => {
    const item: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Chat with Hannah",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      bucketSlug: "hannah",
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.queryAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/chat/hannah/conversation/conversation-1?open=1",
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
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
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
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Archived task")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders archived conversation rows without a link", () => {
    const item: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Archived chat",
      description: null,
      status: "archived",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: new Date("2026-02-20T10:00:00.000Z"),
      credits: null,
      bucketSlug: "hannah",
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={createEmptyHistoryBucketLookups()}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Archived chat")).toBeInTheDocument();
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

  it("adds open=1 to conversation links for mobile chat pane", () => {
    const conversation: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Planning chat",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      bucketSlug: "hannah",
      owner: null,
    };

    expect(getHistoryItemHref(conversation)).toBe(
      "/chat/hannah/conversation/conversation-1?open=1",
    );
  });

  it("uses the fallback bucket segment when bucketSlug is null", () => {
    const conversation: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Untitled chat",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      bucketSlug: null,
      owner: null,
    };

    expect(getHistoryItemHref(conversation)).toBe(
      "/chat/_/conversation/conversation-1?open=1",
    );
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
        bucketLookups={bucketLookups}
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

  it("uses the bucket display name as the conversation fallback subtitle", () => {
    const item: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Planning chat",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      bucketSlug: "hannah",
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={bucketLookups}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(screen.getByText("Hannah")).toBeInTheDocument();
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("passes resolved model data to the chat model icon", () => {
    const item: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Planning chat",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      archivedAt: null,
      credits: null,
      bucketSlug: "gpt-5-4",
      owner: null,
    };

    render(
      <HistoryListItem
        item={item}
        bucketLookups={bucketLookups}
        labels={labels}
        activeOrganizationId={null}
      />,
    );

    expect(iconMocks.chatModelIcon).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "gpt-5-4",
        modelName: "GPT-5.4",
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

    expect(getHistoryRowSubtitle(item, bucketLookups, labels)).toBe(
      "No description",
    );
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
      owner: null,
    };
    const taskWithoutDescription: HistoryItem = {
      ...taskWithDescription,
      description: null,
    };

    expect(
      getHistoryRowSubtitle(taskWithDescription, bucketLookups, labels),
    ).toBe("Audit copy");
    expect(
      getHistoryRowSubtitle(taskWithoutDescription, bucketLookups, labels),
    ).toBe("No description");
  });
});
