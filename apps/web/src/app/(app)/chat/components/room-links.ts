import type { ChatRoomMessage } from "@sokosumi/core-client";
import { listHttpUrls, parseChatRoomFileUrl } from "@sokosumi/utils";

export interface RoomLink {
  url: string;
  message: ChatRoomMessage;
}

/**
 * The web links in these messages, in message order, links to documents
 * included. Files attached in the chat are left out: they are uploads, not
 * links someone shared.
 */
export function roomLinks(messages: readonly ChatRoomMessage[]): RoomLink[] {
  return messages.flatMap((message) =>
    listHttpUrls(message.content)
      .filter((url) => !parseChatRoomFileUrl(url))
      .map((url) => ({ url, message })),
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
