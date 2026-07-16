import { describe, expect, it } from "vitest";
import {
  getVisibleTimelineEvents,
  type JobEvent,
  shouldHighlightJobEventBorder,
  shouldRenderAwaitingInputForm,
  shouldRenderAwaitingInputFormForViewer,
  splitInitiatedEvent,
} from "@/components/jobs/job-details/job-details-events.utils";
import { AgentJobStatus } from "@/lib/clients/generated/core";

function createEvent(
  id: string,
  status: AgentJobStatus,
  overrides?: Partial<JobEvent>,
): JobEvent {
  return {
    id,
    status,
    inputSchema: null,
    result: null,
    createdAt: new Date("2026-02-15T12:00:00.000Z"),
    updatedAt: new Date("2026-02-15T12:00:00.000Z"),
    input: null,
    blobs: [],
    links: [],
    ...overrides,
  };
}

describe("job-details-events utils", () => {
  it("extracts initiated event from the last item and keeps remaining timeline", () => {
    const events = [
      createEvent("running", AgentJobStatus.RUNNING),
      createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT),
      createEvent("initiated", AgentJobStatus.INITIATED),
    ];

    const result = splitInitiatedEvent(events);

    expect(result.initiatedEvent?.id).toBe("initiated");
    expect(result.timelineEvents.map((event) => event.id)).toEqual([
      "running",
      "awaiting-input",
    ]);
  });

  it("keeps full timeline when last event is not initiated", () => {
    const events = [
      createEvent("running", AgentJobStatus.RUNNING),
      createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT),
    ];

    const result = splitInitiatedEvent(events);

    expect(result.initiatedEvent).toBeNull();
    expect(result.timelineEvents).toEqual(events);
  });

  it("collapses long timeline to newest and oldest", () => {
    const events = [
      createEvent("newest", AgentJobStatus.RUNNING),
      createEvent("middle", AgentJobStatus.AWAITING_INPUT),
      createEvent("oldest", AgentJobStatus.FAILED),
    ];

    const result = getVisibleTimelineEvents(events, false);

    expect(result.shouldCollapse).toBe(true);
    expect(result.collapsedCount).toBe(1);
    expect(result.visibleEvents.map((event) => event.id)).toEqual([
      "newest",
      "oldest",
    ]);
  });

  it("renders awaiting input form for latest awaiting-input event without input", () => {
    const event = createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT);

    expect(shouldRenderAwaitingInputForm(event, true)).toBe(true);
  });

  it("does not render awaiting input form for non-latest awaiting-input event without input", () => {
    const event = createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT);

    expect(shouldRenderAwaitingInputForm(event, false)).toBe(false);
  });

  it("does not render awaiting input form for read-only viewers", () => {
    const event = createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT);

    expect(shouldRenderAwaitingInputFormForViewer(event, true, true)).toBe(
      false,
    );
  });

  it("highlights border for latest completed event", () => {
    const event = createEvent("completed", AgentJobStatus.COMPLETED);

    expect(shouldHighlightJobEventBorder(event, true)).toBe(true);
  });

  it("highlights border for latest awaiting-input event without input", () => {
    const event = createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT);

    expect(shouldHighlightJobEventBorder(event, true)).toBe(true);
  });

  it("does not highlight border for non-latest completed event", () => {
    const event = createEvent("completed", AgentJobStatus.COMPLETED);

    expect(shouldHighlightJobEventBorder(event, false)).toBe(false);
  });

  it("does not highlight border for awaiting-input event with input", () => {
    const event = createEvent("awaiting-input", AgentJobStatus.AWAITING_INPUT, {
      input: {
        id: "input-1",
        input: "{}",
      },
    });

    expect(shouldHighlightJobEventBorder(event, true)).toBe(false);
  });
});
