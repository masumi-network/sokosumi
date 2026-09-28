import { describe, expect, it } from "vitest";
import {
  getProjectsByIdCalendarResponseTransformer,
  getWorkspacesCalendarResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

describe("calendar entry dates", () => {
  it.each([
    getWorkspacesCalendarResponseTransformer,
    getProjectsByIdCalendarResponseTransformer,
  ])("transforms dates for both entry types", async (transform) => {
    const result = await transform({
      data: [
        {
          id: "task",
          scheduledAt: "2026-09-23T12:00:00.000Z",
          originalScheduledAt: "2026-09-23T11:00:00.000Z",
        },
        {
          kind: "socialPost",
          id: "social:post",
          scheduledAt: "2026-09-23T12:00:00.000Z",
        },
      ],
      meta: { timestamp: "2026-09-23T12:00:00.000Z" },
    });
    expect(result.data[0]?.scheduledAt).toBeInstanceOf(Date);
    expect(result.data[0]?.originalScheduledAt).toBeInstanceOf(Date);
    expect(result.data[1]?.scheduledAt).toBeInstanceOf(Date);
    expect(result.data[1]?.originalScheduledAt).toBeUndefined();
  });
});
