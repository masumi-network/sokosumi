import { describe, expect, it } from "vitest";

import { getHistoryResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

describe("getHistoryResponseTransformer", () => {
  it("converts meta.timestamp to a Date and leaves consumedAt unchanged", async () => {
    const data = {
      data: [
        {
          kind: "task",
          id: "tx-1",
          title: "Review onboarding",
          description: null,
          consumedAt: "2026-02-19T10:00:00.000Z",
          credits: 2,
          projectId: null,
          owner: null,
          taskId: "task-1",
          taskEventId: "event-1",
        },
        {
          kind: "job",
          id: "tx-2",
          title: "Test job",
          description: null,
          consumedAt: "2026-02-19T11:00:00.000Z",
          credits: 5,
          projectId: null,
          owner: null,
          jobId: "job-1",
          agentId: "agent-1",
          agentName: "Research Agent",
          agentIcon: "https://example.com/research.svg",
        },
      ],
      meta: {
        timestamp: "2026-02-19T12:00:00.000Z",
        pagination: {
          cursor: null,
          limit: 20,
          total: 2,
          nextCursor: null,
        },
      },
    };

    const result = await getHistoryResponseTransformer(structuredClone(data));

    expect(result.data[0]?.consumedAt).toBe("2026-02-19T10:00:00.000Z");
    expect(result.data[1]?.consumedAt).toBe("2026-02-19T11:00:00.000Z");
    expect(result.meta.timestamp).toEqual(new Date("2026-02-19T12:00:00.000Z"));
  });
});
