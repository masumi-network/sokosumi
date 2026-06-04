import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getHistoryItemHref,
  HistoryListItem,
  type HistoryListItemLabels,
} from "@/app/history/components/history-list-item";
import {
  createEmptyHistorySubtitleLookups,
  getHistoryRowSubtitle,
  type HistorySubtitleLookups,
} from "@/app/history/utils/history-row-subtitle";
import type { HistoryItem } from "@/lib/services/history.service";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/agents/agent-icon", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
}));

vi.mock("@/components/chat/chat-model-icon", () => ({
  ChatModelIcon: () => <span data-testid="chat-model-icon" />,
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
};

const subtitleLookups: HistorySubtitleLookups = {
  agentNameById: {
    "agent-1": "Research Agent",
  },
  bucketDisplayNameBySlug: {
    hannah: "Hannah",
  },
};

describe("HistoryListItem", () => {
  it("renders when updatedAt is an ISO string from the server boundary", () => {
    const item = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: null,
      status: "READY",
      updatedAt: "2026-02-19T10:00:00.000Z",
      credits: 1,
      projectId: null,
      coworkerId: null,
    } as HistoryItem;

    render(
      <HistoryListItem
        item={item}
        subtitleLookups={createEmptyHistorySubtitleLookups()}
        labels={labels}
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
      credits: null,
      bucketSlug: "hannah",
    };

    render(
      <HistoryListItem
        item={item}
        subtitleLookups={createEmptyHistorySubtitleLookups()}
        labels={labels}
      />,
    );

    expect(screen.queryAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/chat/hannah/conversation/conversation-1",
    );
  });

  it("builds task and job deep links", () => {
    const task: HistoryItem = {
      kind: "task",
      id: "task-1",
      title: "Review onboarding",
      description: "Audit copy",
      status: "READY",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      credits: 1,
      projectId: null,
      coworkerId: null,
    };
    const job: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Analyze data",
      description: null,
      status: "completed",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      credits: 2,
      projectId: null,
      agentId: "agent-1",
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
      credits: 2,
      projectId: null,
      agentId: "agent-1",
    };

    render(
      <HistoryListItem
        item={item}
        subtitleLookups={subtitleLookups}
        labels={labels}
      />,
    );

    expect(screen.getByText("Research Agent")).toBeInTheDocument();
  });

  it("uses the bucket display name as the conversation fallback subtitle", () => {
    const item: HistoryItem = {
      kind: "conversation",
      id: "conversation-1",
      title: "Planning chat",
      description: null,
      status: "active",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      credits: null,
      bucketSlug: "hannah",
    };

    render(
      <HistoryListItem
        item={item}
        subtitleLookups={subtitleLookups}
        labels={labels}
      />,
    );

    expect(screen.getByText("Hannah")).toBeInTheDocument();
  });

  it("does not repeat the title when the fallback subtitle matches it", () => {
    const item: HistoryItem = {
      kind: "job",
      id: "job-1",
      title: "Research Agent",
      description: null,
      status: "completed",
      updatedAt: new Date("2026-02-19T10:00:00.000Z"),
      credits: 2,
      projectId: null,
      agentId: "agent-1",
    };

    expect(getHistoryRowSubtitle(item, subtitleLookups, labels)).toBe(
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
      credits: 1,
      projectId: null,
      coworkerId: null,
    };
    const taskWithoutDescription: HistoryItem = {
      ...taskWithDescription,
      description: null,
    };

    expect(
      getHistoryRowSubtitle(taskWithDescription, subtitleLookups, labels),
    ).toBe("Audit copy");
    expect(
      getHistoryRowSubtitle(taskWithoutDescription, subtitleLookups, labels),
    ).toBe("No description");
  });
});
