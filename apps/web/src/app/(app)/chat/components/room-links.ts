import type { ChatRoomMessage } from "@sokosumi/core-client";
import { selectUnfurlCandidateUrls } from "@sokosumi/utils";

export interface RoomLink {
  url: string;
  message: ChatRoomMessage;
}

/**
 * The web links in these messages, in message order. Files are left out:
 * the room's files have their own list.
 */
// ponytail: up to 3 links per message (the unfurl cap); lift if people post link lists.
export function roomLinks(messages: readonly ChatRoomMessage[]): RoomLink[] {
  return messages.flatMap((message) =>
    selectUnfurlCandidateUrls(message.content).map((url) => ({
      url,
      message,
    })),
  );
}

/** A link as people read it: the site, then the rest. */
export function linkLabel(url: string): { host: string; path: string } {
  const parsed = new URL(url);
  const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return {
    host: parsed.hostname.replace(/^www\./, ""),
    path: rest === "/" ? "" : rest,
  };
}
