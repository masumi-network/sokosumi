import { TaskEventOrigin } from "@sokosumi/utils";

import type { Coworker as CoreCoworker } from "@/lib/clients/generated/core";
import type { CoworkerChannel } from "@/lib/types/coworker";

const COWORKER_CHANNEL_SPECS: ReadonlyArray<{
  channelKey: string;
  origin: TaskEventOrigin;
}> = [
  { channelKey: "email", origin: TaskEventOrigin.EMAIL },
  { channelKey: "whatsapp", origin: TaskEventOrigin.WHATSAPP },
  { channelKey: "telegram", origin: TaskEventOrigin.TELEGRAM },
  { channelKey: "teams", origin: TaskEventOrigin.TEAMS },
  { channelKey: "discord", origin: TaskEventOrigin.DISCORD },
];

/**
 * Reads non-empty contact channel values from coworker.metadata.channels
 * (email, whatsapp, telegram, teams, discord) in a stable display order.
 */
export function getCoworkerMetadataChannels(
  coworker: Pick<CoreCoworker, "metadata">,
): CoworkerChannel[] {
  const metadataChannels = coworker.metadata?.channels ?? {};
  const channels: CoworkerChannel[] = [];

  for (const { channelKey, origin } of COWORKER_CHANNEL_SPECS) {
    const raw = metadataChannels[channelKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      channels.push({ origin, value });
    }
  }

  return channels;
}
