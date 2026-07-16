import { Channel } from "@sokosumi/utils";

import type { Coworker as CoreCoworker } from "@/lib/clients/generated/core";
import type { CoworkerChannel } from "@/lib/types/coworker";

const COWORKER_CHANNEL_SPECS: ReadonlyArray<{
  channelKey: string;
  channel: Channel;
}> = [
  { channelKey: "email", channel: Channel.EMAIL },
  { channelKey: "whatsapp", channel: Channel.WHATSAPP },
  { channelKey: "telegram", channel: Channel.TELEGRAM },
  { channelKey: "teams", channel: Channel.TEAMS },
  { channelKey: "discord", channel: Channel.DISCORD },
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

  for (const { channelKey, channel } of COWORKER_CHANNEL_SPECS) {
    const raw = metadataChannels[channelKey];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) {
      channels.push({ channel, value });
    }
  }

  return channels;
}
