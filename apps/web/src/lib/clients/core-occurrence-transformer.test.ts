import { describe, expect, it } from "vitest";

import { getTasksByIdScheduleOccurrencesResponseTransformer } from "@/lib/clients/generated/core/transformers.gen";

/**
 * Regression guard for SOK-884: the occurrence transformer used to call the
 * released-task transformer without a null guard, so any planned or canceled
 * occurrence (releasedTask: null) threw and the Task-detail runs section fell
 * back to "Runs could not be loaded".
 */
describe("getTasksByIdScheduleOccurrencesResponseTransformer", () => {
  it("maps a planned occurrence whose releasedTask is null without throwing", async () => {
    const result = await getTasksByIdScheduleOccurrencesResponseTransformer({
      data: {
        scheduleRevision: 0,
        futureExceptionCount: 0,
        occurrences: [
          {
            id: "01a08fc0-b522-707a-b965-4acc5d29b5cc",
            state: "PLANNED",
            scheduleVersion: 2,
            epochId: "01d14468-a359-4107-9949-4143c94dfccf",
            originalScheduledAt: "2026-09-11T10:00:00.000Z",
            effectiveScheduledAt: "2026-09-11T10:00:00.000Z",
            timezone: "Europe/Prague",
            isMissed: false,
            sourceId: "project:01a08fc0-25ee-707f-b1b9-008835ced55a",
            sourceWorkspaceId: "03d70dc0-f302-45d5-a161-86beb31d2448",
            sourceType: "PROJECT",
            sourceProjectId: "01a08fc0-25ee-707f-b1b9-008835ced55a",
            sourceAccuracy: "EXACT",
            timeAccuracy: "EXACT",
            releasedTask: null,
          },
        ],
      },
      meta: { timestamp: "2026-09-11T09:26:25.285Z" },
    });

    expect(result.data.occurrences[0].releasedTask).toBeNull();
    expect(result.data.occurrences[0].effectiveScheduledAt).toBeInstanceOf(
      Date,
    );
  });
});
