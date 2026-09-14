import { describe, expect, it } from "vitest";

import { patchTasksByIdScheduleOccurrencesByOccurrenceIdResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

describe("schedule occurrence response transformer", () => {
  it("accepts a successful move whose planned occurrence has no released Task", async () => {
    const result =
      await patchTasksByIdScheduleOccurrencesByOccurrenceIdResponseTransformer({
        data: {
          scheduleRevision: 5,
          occurrence: {
            id: "33333333-3333-7333-8333-333333333333",
            state: "PLANNED",
            scheduleVersion: 2,
            epochId: "44444444-4444-7444-8444-444444444444",
            originalScheduledAt: "2026-09-20T09:00:00.000Z",
            effectiveScheduledAt: "2026-09-21T09:00:00.000Z",
            timezone: "UTC",
            isMissed: false,
            sourceId: "workspace:11111111-1111-7111-8111-111111111111",
            sourceWorkspaceId: "11111111-1111-7111-8111-111111111111",
            sourceType: "WORKSPACE",
            sourceProjectId: null,
            sourceAccuracy: "EXACT",
            timeAccuracy: "EXACT",
            releasedTask: null,
          },
        },
        meta: {
          timestamp: "2026-09-13T10:00:00.000Z",
          requestId: "req_1",
        },
      });

    expect(result.data.occurrence.releasedTask).toBeNull();
    expect(result.data.occurrence.effectiveScheduledAt).toBeInstanceOf(Date);
  });
});
