import {
  MARKER_ICONS,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

/**
 * The job scale on the same three rules as the task scale, so a job and a
 * task at the same stage look the same. Hue is the board column, weight is
 * the status inside it, a fault leaves its column. See `status-marker.tsx`.
 *
 * `jobs-list-view.tsx` owns the column grouping this follows.
 */
const JOB_STATUS_MARKERS: Record<SokosumiJobStatus, StatusMarkerSpec> = {
  // todo: the payment settles, then the coworker holds the job. Neither is
  // running yet. They used to share a glyph as well as a hue, which left the
  // labels as the only thing telling them apart; the glyphs now differ and
  // the weight separates them.
  [SokosumiJobStatus.PAYMENT_PENDING]: {
    tone: { hue: "staged", weight: "outline" },
    icon: MARKER_ICONS.hiring,
  },
  [SokosumiJobStatus.STARTED]: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.ready,
  },

  // in-progress: the only state where work is happening.
  [SokosumiJobStatus.PROCESSING]: {
    tone: { hue: "active", weight: "filled" },
    icon: MARKER_ICONS.running,
    spin: true,
  },
  // The refund is proceeding normally and needs nothing from the reader, who
  // already knows the job failed. A red tint would charge them twice for one
  // event, so it stays in its column rather than taking the fault override.
  [SokosumiJobStatus.REFUND_PENDING]: {
    tone: { hue: "active", weight: "outline" },
    icon: MARKER_ICONS.refund,
  },

  // Both of these sit under in-progress and both are faults, so rule 3 pulls
  // them out of that column's hue. "Result Missing" is an accusation, not a
  // wait: the seller is past its deadline and the next move is a refund.
  [SokosumiJobStatus.RESULT_PENDING]: {
    tone: { hue: "fault", weight: "filled" },
    icon: MARKER_ICONS.resultMissing,
  },
  // Contested money with an arbiter deciding. The outline says it is not
  // settled; the resolved row below says nothing about who won, so neither
  // badge implies it.
  [SokosumiJobStatus.DISPUTE_PENDING]: {
    tone: { hue: "fault", weight: "outline" },
    icon: MARKER_ICONS.dispute,
  },

  // The one badge that should pull the eye: nothing moves until the reader
  // answers.
  [SokosumiJobStatus.INPUT_REQUIRED]: {
    tone: { hue: "blocked", weight: "filled" },
    icon: MARKER_ICONS.input,
  },

  [SokosumiJobStatus.COMPLETED]: {
    tone: { hue: "resolved", weight: "filled" },
    icon: MARKER_ICONS.completed,
  },
  // Both are terminal: this job produced nothing and the only way forward is
  // to hire again. A tint would imply it may still resolve.
  [SokosumiJobStatus.FAILED]: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
  [SokosumiJobStatus.PAYMENT_FAILED]: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.hiringFailed,
  },
  // Money back, no work. Not green: green sits beside Completed and would
  // claim a result that never arrived. The case is closed, so it is dormant.
  [SokosumiJobStatus.REFUND_RESOLVED]: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.refund,
  },
  [SokosumiJobStatus.DISPUTE_RESOLVED]: {
    tone: { hue: "dormant", weight: "outline" },
    icon: MARKER_ICONS.dispute,
  },
};

const DEFAULT_JOB_MARKER: StatusMarkerSpec = {
  tone: { hue: "dormant", weight: "outline" },
  icon: MARKER_ICONS.queued,
};

export function getJobStatusMarker(
  status: SokosumiJobStatus,
): StatusMarkerSpec {
  return JOB_STATUS_MARKERS[status] ?? DEFAULT_JOB_MARKER;
}
