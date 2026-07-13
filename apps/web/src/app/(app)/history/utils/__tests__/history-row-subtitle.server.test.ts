import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "@/lib/services/history.service";

const coworkerServiceMock = vi.hoisted(() => ({
  listCoworkersForUi: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: coworkerServiceMock,
}));

describe("buildHistoryBucketLookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves coworker bucket icons and model bucket icons", async () => {
    coworkerServiceMock.listCoworkersForUi.mockResolvedValue([
      {
        id: "coworker-1",
        slug: "hannah",
        name: "Hannah",
        image: "https://example.com/hannah.webp",
      },
    ]);

    const { buildHistoryBucketLookups } = await import(
      "@/app/history/utils/history-row-subtitle.server"
    );
    const result = await buildHistoryBucketLookups([
      {
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
      },
      {
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
      },
      {
        kind: "conversation",
        id: "conversation-2",
        title: "Chat with GPT-5.4",
        description: null,
        status: "active",
        updatedAt: new Date("2026-02-19T10:00:00.000Z"),
        archivedAt: null,
        credits: null,
        bucketSlug: "gpt-5-4",
        owner: null,
      },
    ] satisfies HistoryItem[]);

    expect(result.bucketIconBySlug.hannah).toEqual({
      kind: "coworker",
      name: "Hannah",
      imageUrl: "https://example.com/hannah.webp",
    });
    expect(result.bucketIconBySlug["gpt-5-4"]).toEqual({
      kind: "model",
      modelId: "gpt-5-4",
      modelName: "GPT-5.4",
    });
  });
});
