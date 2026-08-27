import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { flattenLinkJobId } from "./link.js";

describe("flattenLinkJobId", () => {
  it("flattens event.jobId onto the link", () => {
    const flattened = flattenLinkJobId({
      id: "link-1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      eventId: "event-1",
      url: "https://example.com",
      title: null,
      event: { jobId: "job-1" },
    });

    assert.equal(flattened.jobId, "job-1");
    assert.equal(flattened.id, "link-1");
    assert.equal("event" in flattened, false);
  });

  it("throws when the event relation is missing", () => {
    assert.throws(
      () =>
        flattenLinkJobId({
          id: "link-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          eventId: "event-1",
          url: "https://example.com",
          title: null,
          event: undefined as unknown as { jobId: string },
        }),
      /missing job event/,
    );
  });
});
