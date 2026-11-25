import type { SokoBotStatus } from "@sokosumi/core-client";

import {
  MARKER_ICONS,
  type StatusMarkerSpec,
} from "@/components/ui/status-marker";

/**
 * The Task board's status scale, read for a bot. Idle is `staged`, like a
 * Ready task: free to take work. Running is `active` and spins. Paused waits
 * on someone, so it is `blocked`; Error is `fault`.
 */
export const SOKO_BOT_STATUS_MARKERS: Record<SokoBotStatus, StatusMarkerSpec> =
  {
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
