import type { SokoBotStatus } from "@sokosumi/core-client";

import { SOKO_BOT_STATUS_MARKERS } from "@/app/soko-bots/components/soko-bot-status-markers";
import { StatusMarker } from "@/components/ui/status-marker";

/** A bot's status as plain text; only a bot that is not idle gets a marker. */
export function AgentStatus({
  status,
  label,
}: {
  status: SokoBotStatus;
  label: string;
}) {
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs">
      {status === "IDLE" ? null : (
        <StatusMarker spec={SOKO_BOT_STATUS_MARKERS[status]} />
      )}
      {label}
    </span>
  );
}
