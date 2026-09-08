import { describe, expect, it } from "vitest";

import { thoughtTimingFromMessageMetadata } from "./conversation-message-api-content";

describe("thoughtTimingFromMessageMetadata", () => {
  it("returns undefined when absent", () => {
    expect(thoughtTimingFromMessageMetadata(null)).toBeUndefined();
  });

  it("reads numeric start/end", () => {
    expect(
      thoughtTimingFromMessageMetadata({
        thought_timing_ms: { start: 100, end: 200 },
      }),
    ).toEqual({ startedAtMs: 100, endedAtMs: 200 });
  });

  it("coerces string timestamps from JSON", () => {
    expect(
      thoughtTimingFromMessageMetadata({
        thought_timing_ms: { start: "100", end: "200" },
      }),
    ).toEqual({ startedAtMs: 100, endedAtMs: 200 });
  });
});
