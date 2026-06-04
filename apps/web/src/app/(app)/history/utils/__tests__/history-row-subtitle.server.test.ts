import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "@/lib/services/history.service";

const prismaMock = vi.hoisted(() => ({
  agent: {
    findMany: vi.fn(),
  },
}));

const coworkerServiceMock = vi.hoisted(() => ({
  listCoworkers: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/prisma", () => ({
  default: prismaMock,
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: coworkerServiceMock,
}));

describe("buildHistorySubtitleLookups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves agent icons, coworker bucket icons, and model bucket icons", async () => {
    prismaMock.agent.findMany.mockResolvedValue([
      {
        id: "agent-1",
        name: "Research Agent",
        overrideName: null,
        icon: "https://example.com/research.svg",
      },
    ]);
    coworkerServiceMock.listCoworkers.mockResolvedValue([
      {
        id: "coworker-1",
        slug: "hannah",
        name: "Hannah",
        image: "https://example.com/hannah.webp",
      },
    ]);

    const { buildHistorySubtitleLookups } = await import(
      "@/app/history/utils/history-row-subtitle.server"
    );
    const result = await buildHistorySubtitleLookups([
      {
        kind: "job",
        id: "job-1",
        title: "Analyze data",
        description: null,
        status: "completed",
        updatedAt: new Date("2026-02-19T10:00:00.000Z"),
        credits: 2,
        projectId: null,
        agentId: "agent-1",
      },
      {
        kind: "conversation",
        id: "conversation-1",
        title: "Chat with Hannah",
        description: null,
        status: "active",
        updatedAt: new Date("2026-02-19T10:00:00.000Z"),
        credits: null,
        bucketSlug: "hannah",
      },
      {
        kind: "conversation",
        id: "conversation-2",
        title: "Chat with GPT-5.4",
        description: null,
        status: "active",
        updatedAt: new Date("2026-02-19T10:00:00.000Z"),
        credits: null,
        bucketSlug: "gpt-5-4",
      },
    ] satisfies HistoryItem[]);

    expect(result.agentPreviewById).toEqual({
      "agent-1": {
        name: "Research Agent",
        icon: "https://example.com/research.svg",
      },
    });
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
