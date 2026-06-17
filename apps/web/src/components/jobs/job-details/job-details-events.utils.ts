"use client";

import { AgentJobStatus } from "@sokosumi/utils";

import type { Job } from "@/lib/clients/generated/core";

/** Event payload of the core `Job` detail DTO consumed by job details. */
export type JobEvent = Job["events"][number];

export interface JobTimelineEvents {
  initiatedEvent: JobEvent | null;
  timelineEvents: JobEvent[];
}

export interface VisibleJobTimelineEvents {
  shouldCollapse: boolean;
  collapsedCount: number;
  visibleEvents: JobEvent[];
}

export function splitInitiatedEvent(events: JobEvent[]): JobTimelineEvents {
  const initiatedCandidate = events.at(-1);
  if (!initiatedCandidate) {
    return {
      initiatedEvent: null,
      timelineEvents: events,
    };
  }

  if (initiatedCandidate.status !== AgentJobStatus.INITIATED) {
    return {
      initiatedEvent: null,
      timelineEvents: events,
    };
  }

  return {
    initiatedEvent: initiatedCandidate,
    timelineEvents: events.slice(0, -1),
  };
}

export function getVisibleTimelineEvents(
  events: JobEvent[],
  showAllEvents: boolean,
): VisibleJobTimelineEvents {
  const shouldCollapse = events.length > 2 && !showAllEvents;
  if (!shouldCollapse) {
    return {
      shouldCollapse: false,
      collapsedCount: 0,
      visibleEvents: events,
    };
  }

  return {
    shouldCollapse: true,
    collapsedCount: events.length - 2,
    visibleEvents: [events[0], events[events.length - 1]],
  };
}

export function shouldRenderAwaitingInputForm(
  event: JobEvent,
  isLatestEvent: boolean,
): boolean {
  return (
    isLatestEvent &&
    event.status === AgentJobStatus.AWAITING_INPUT &&
    event.input == null
  );
}

export function shouldRenderAwaitingInputFormForViewer(
  event: JobEvent,
  isLatestEvent: boolean,
  readOnly: boolean,
): boolean {
  return !readOnly && shouldRenderAwaitingInputForm(event, isLatestEvent);
}

export function shouldHighlightJobEventBorder(
  event: JobEvent,
  isLatestEvent: boolean,
): boolean {
  if (!isLatestEvent) {
    return false;
  }

  if (event.status === AgentJobStatus.COMPLETED) {
    return true;
  }

  return event.status === AgentJobStatus.AWAITING_INPUT && event.input == null;
}
