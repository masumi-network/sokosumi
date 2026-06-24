import { SokosumiJobStatus, TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  historyConversationItemSchema,
  historyItemSchema,
  historyListResponseExample,
  historyListSchema,
} from "./history.schema";

const taskItem = {
  kind: "task",
  id: "tsk_123",
  title: "Review onboarding flow",
  description: "Audit copy and empty states",
  status: TaskStatus.RUNNING,
  updatedAt: "2025-01-21T12:00:00.000Z",
  archivedAt: null,
  credits: 2.5,
  projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  coworkerId: "cow_123",
  owner: null,
};

const jobItem = {
  kind: "job",
  id: "job_123",
  title: "Research competitors",
  description: "Generated market summary",
  status: SokosumiJobStatus.COMPLETED,
  updatedAt: "2025-01-21T11:30:00.000Z",
  archivedAt: null,
  credits: 5,
  projectId: null,
  agentId: "agent_123",
  agentName: "Research Agent",
  agentIcon: "https://example.com/research.svg",
  owner: null,
};

const conversationItem = {
  kind: "conversation",
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "Chat with Hannah",
  description: null,
  status: "active",
  updatedAt: "2025-01-21T11:00:00.000Z",
  archivedAt: null,
  credits: null,
  bucketSlug: "hannah",
  owner: null,
};

describe("history schemas", () => {
  it("parses a mixed history list payload", () => {
    const result = historyListSchema.parse([
      taskItem,
      jobItem,
      conversationItem,
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("task");
    expect(result[1].kind).toBe("job");
    expect(result[2].kind).toBe("conversation");
  });

  it("converts Date fields to ISO strings", () => {
    const result = historyItemSchema.parse({
      ...taskItem,
      updatedAt: new Date("2025-01-21T12:00:00.000Z"),
    });

    expect(result.updatedAt).toBe("2025-01-21T12:00:00.000Z");
  });

  it("requires conversation credits to be null", () => {
    expect(() =>
      historyConversationItemSchema.parse({
        ...conversationItem,
        credits: 1,
      }),
    ).toThrow();
  });

  it("keeps the OpenAPI paginated response example parseable", () => {
    const result = historyListSchema.parse(historyListResponseExample.data);

    expect(result[2]).toMatchObject({
      kind: "conversation",
      credits: null,
    });
    expect(historyListResponseExample.meta.pagination.nextCursor).toEqual(
      expect.any(String),
    );
  });
});
