import {
  MARKER_ICONS,
  STATUS_ROLE_STYLES,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

/**
 * The job scale in the same five roles the task badge uses, so a job and a
 * task that mean the same thing look the same. Colour carries urgency, the
 * glyph carries identity. See `status-marker.tsx`.
 *
 * The two `*_RESOLVED` states stay neutral on purpose: the case is closed, and
 * neither outcome is the one the user was hoping for.
 */
const JOB_STATUS_MARKERS: Record<SokosumiJobStatus, StatusMarkerSpec> = {
  // Placed by what the reader must do and whether anything is wrong, the same
  // two questions the task badge answers.

  // Two steps of getting the job underway: the payment settles, then the
  // coworker takes it on. The reader is not blocked in either, so neither is
  // amber and both sit in the same role. They take different glyphs because
  // colour carries urgency and the glyph carries identity, and these are two
  // different moments.
  [SokosumiJobStatus.PAYMENT_PENDING]: {
    role: "queued",
    icon: MARKER_ICONS.hiring,
  },
  [SokosumiJobStatus.STARTED]: { role: "queued", icon: MARKER_ICONS.ready },

  // The only state where work is happening.
  [SokosumiJobStatus.PROCESSING]: {
    role: "active",
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
    role: "waiting",
    icon: MARKER_ICONS.refund,
  },
  // Money back, no work. Not green: green sits beside Completed and would
  // claim a result that never arrived.
  [SokosumiJobStatus.REFUND_RESOLVED]: {
    role: "closed",
    icon: MARKER_ICONS.refund,
  },

  // Contested money with an arbiter deciding. The resolved label does not say
  // who won, so the badge must not imply it either.
  [SokosumiJobStatus.DISPUTE_PENDING]: {
    role: "problem",
    icon: MARKER_ICONS.dispute,
  },
  [SokosumiJobStatus.DISPUTE_RESOLVED]: {
    role: "closed",
    icon: MARKER_ICONS.dispute,
  },

  [SokosumiJobStatus.COMPLETED]: {
    role: "success",
    icon: MARKER_ICONS.completed,
  },
};

const DEFAULT_JOB_MARKER: StatusMarkerSpec = {
  role: "idle",
  icon: MARKER_ICONS.queued,
};

export function getJobStatusMarker(
  status: SokosumiJobStatus,
): StatusMarkerSpec {
  return JOB_STATUS_MARKERS[status] ?? DEFAULT_JOB_MARKER;
}

/** Kept for callers that paint a bare dot outside a badge. */
export function getJobStatusDotColorClass(status: SokosumiJobStatus): string {
  return STATUS_ROLE_STYLES[getJobStatusMarker(status).role].dot;
}
