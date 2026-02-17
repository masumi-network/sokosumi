"use client";

import { AgentJobStatus, type JobEventWithRelations } from "@sokosumi/database";

export interface JobTimelineEvents {
  initiatedEvent: JobEventWithRelations | null;
  timelineEvents: JobEventWithRelations[];
}

export interface VisibleJobTimelineEvents {
  shouldCollapse: boolean;
  collapsedCount: number;
  visibleEvents: JobEventWithRelations[];
}

export function splitInitiatedEvent(
  events: JobEventWithRelations[],
): JobTimelineEvents {
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
  events: JobEventWithRelations[],
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
  event: JobEventWithRelations,
  isLatestEvent: boolean,
): boolean {
  return (
    isLatestEvent &&
    event.status === AgentJobStatus.AWAITING_INPUT &&
    event.input == null
  );
}

export function shouldRenderAwaitingInputFormForViewer(
  event: JobEventWithRelations,
  isLatestEvent: boolean,
  readOnly: boolean,
): boolean {
  return !readOnly && shouldRenderAwaitingInputForm(event, isLatestEvent);
}
