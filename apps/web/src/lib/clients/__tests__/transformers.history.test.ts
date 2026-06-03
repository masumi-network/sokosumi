import { describe, expect, it } from "vitest";

import { getHistoryResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

describe("getHistoryResponseTransformer", () => {
  it("converts history item updatedAt strings to Date objects", async () => {
    const data = {
      data: [
        {
          kind: "task",
          id: "task-1",
          title: "Test task",
          description: null,
          status: "READY",
          updatedAt: "2026-02-19T10:00:00.000Z",
          credits: 2,
          projectId: null,
          coworkerId: null,
        },
        {
          kind: "job",
          id: "job-1",
          title: "Test job",
          description: null,
          status: "completed",
          updatedAt: "2026-02-19T11:00:00.000Z",
          credits: 5,
          projectId: null,
          agentId: "agent-1",
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

    expect(result.data[0]?.updatedAt).toEqual(
      new Date("2026-02-19T10:00:00.000Z"),
    );
    expect(result.data[1]?.updatedAt).toEqual(
      new Date("2026-02-19T11:00:00.000Z"),
    );
    expect(result.meta.timestamp).toEqual(new Date("2026-02-19T12:00:00.000Z"));
  });
});
