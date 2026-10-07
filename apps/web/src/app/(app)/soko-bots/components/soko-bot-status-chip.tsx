import type { SokoBotStatus } from "@sokosumi/core-client";
import {
  getToneStyle,
  MARKER_ICONS,
  StatusMarker,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";
import { cn } from "@/lib/utils";

/**
 * The Task board's status scale, read for a bot. Idle is `staged`, like a
 * Ready task: free to take work. Running is `active` and spins. Paused waits
 * on someone, so it is `blocked`; Error is `fault`.
 */
const SOKO_BOT_STATUS_MARKERS: Record<SokoBotStatus, StatusMarkerSpec> = {
  IDLE: {
    tone: { hue: "staged", weight: "filled" },
    icon: MARKER_ICONS.ready,
  },
  RUNNING: {
    tone: { hue: "active", weight: "filled" },
    icon: MARKER_ICONS.running,
    spin: true,
  },
  PAUSED: {
    tone: { hue: "blocked", weight: "outline" },
    icon: MARKER_ICONS.awaiting,
  },
  ERROR: {
    tone: { hue: "fault", weight: "solid" },
    icon: MARKER_ICONS.failed,
  },
};

/**
 * A bot's status, drawn the way the Task board draws a task's. Idle is the
 * resting state of nearly every bot, so it draws nothing: a chip only shows
 * when there is something to notice.
 */
export function SokoBotStatusChip({
  status,
  label,
  size = "md",
  className,
}: {
  status: SokoBotStatus;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  if (status === "IDLE") return null;
  const marker = SOKO_BOT_STATUS_MARKERS[status];
  const style = getToneStyle(marker.tone);
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border text-xs font-medium",
        size === "sm" ? "h-5 px-1.5" : "h-6 px-2",
        style.box,
        style.label,
        className,
      )}
    >
      <StatusMarker spec={marker} />
      <span>{label}</span>
    </span>
  );
}
