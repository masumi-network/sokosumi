import { TaskStatus } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
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

describe("history schemas", () => {
  it("parses a mixed history list payload", () => {
    const result = historyListSchema.parse([taskItem, jobItem]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("task");
    expect(result[1].kind).toBe("job");
  });

  it("converts Date fields to ISO strings", () => {
    const result = historyItemSchema.parse({
      ...taskItem,
      updatedAt: new Date("2025-01-21T12:00:00.000Z"),
    });

    expect(result.updatedAt).toBe("2025-01-21T12:00:00.000Z");
  });

  it("keeps the OpenAPI paginated response example parseable", () => {
    const result = historyListSchema.parse(historyListResponseExample.data);

    expect(result[1]).toMatchObject({
      kind: "job",
      credits: 5,
    });
    expect(historyListResponseExample.meta.pagination.nextCursor).toEqual(
      expect.any(String),
    );
  });
});
