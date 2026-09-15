import {
  MARKER_ICONS,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

/**
 * The job scale in the same seven roles the task badge uses, so a job and a
 * task that mean the same thing look the same. Colour says what the reader
 * must do; the glyph says which status it is. See `status-marker.tsx`.
 *
 * The two `*_RESOLVED` states stay neutral on purpose: the case is closed, and
 * neither outcome is the one the user was hoping for.
 */
const JOB_STATUS_MARKERS: Record<SokosumiJobStatus, StatusMarkerSpec> = {
  // Placed by what the reader must do and whether anything is wrong, the same
  // two questions the task badge answers.

  // The payment is settling and then the coworker holds the job. The reader
  // is not blocked in either, so neither is amber. They are one stage seen
  // twice, and to the reader it is one stage, so they share a role and a
  // glyph on purpose. The labels are what tell them apart. This is the one
  // deliberate pair that shares a role AND a glyph, and status-marker.test.tsx
  // names it. Other pairs share a glyph across two roles, which the colour
  // separates.
  [SokosumiJobStatus.PAYMENT_PENDING]: {
    role: "working",
    icon: MARKER_ICONS.hiring,
  },
  [SokosumiJobStatus.STARTED]: { role: "working", icon: MARKER_ICONS.hiring },

  // The only state where work is happening.
  [SokosumiJobStatus.PROCESSING]: {
    role: "working",
    icon: MARKER_ICONS.running,
    spin: true,
  },

  // The one badge that should pull the eye: nothing moves until the reader
  // answers.
  [SokosumiJobStatus.INPUT_REQUIRED]: {
    role: "action",
    icon: MARKER_ICONS.input,
  },

  // "Result Missing" is an accusation, not a wait: the seller is past its
  // deadline and the reader's next move is usually a refund.
  [SokosumiJobStatus.RESULT_PENDING]: {
    role: "problem",
    icon: MARKER_ICONS.resultMissing,
  },

  // Both are terminal: this job produced nothing and the only way forward is
  // to hire again. A tint would imply it may still resolve.
  [SokosumiJobStatus.FAILED]: { role: "failure", icon: MARKER_ICONS.failed },
  [SokosumiJobStatus.PAYMENT_FAILED]: {
    role: "failure",
    icon: MARKER_ICONS.hiringFailed,
  },

  // The refund is proceeding normally and needs nothing from the reader, who
  // already knows the job failed. A red tint would charge them twice for one
  // event.
  [SokosumiJobStatus.REFUND_PENDING]: {
    role: "external",
    icon: MARKER_ICONS.refund,
  },
  // Money back, no work. Not green: green sits beside Completed and would
  // claim a result that never arrived.
  [SokosumiJobStatus.REFUND_RESOLVED]: {
    role: "inert",
    icon: MARKER_ICONS.refund,
  },

  // Contested money with an arbiter deciding. The resolved label does not say
  // who won, so the badge must not imply it either.
  [SokosumiJobStatus.DISPUTE_PENDING]: {
    role: "problem",
    icon: MARKER_ICONS.dispute,
  },
  [SokosumiJobStatus.DISPUTE_RESOLVED]: {
    role: "inert",
    icon: MARKER_ICONS.dispute,
  },

  [SokosumiJobStatus.COMPLETED]: {
    role: "success",
    icon: MARKER_ICONS.completed,
  },
};

const DEFAULT_JOB_MARKER: StatusMarkerSpec = {
  role: "inert",
  icon: MARKER_ICONS.queued,
};

export function getJobStatusMarker(
  status: SokosumiJobStatus,
): StatusMarkerSpec {
  return JOB_STATUS_MARKERS[status] ?? DEFAULT_JOB_MARKER;
}
