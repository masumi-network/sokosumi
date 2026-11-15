/**
 * Files people attach in the Buzz app live on the relay (Blossom), which serves
 * them only to signed-in members. Sokosumi's clients cannot sign, so a file a
 * Buzz message carries is copied into Sokosumi's public chat-file storage and
 * the message points there instead, as if it had been uploaded in Sokosumi.
 */
import { createHash } from "node:crypto";
import {
  buildCoworkerChatRoomFilePathname,
  buildUserChatRoomFilePathname,
  CHAT_ROOM_FILE_MAX_SIZE_BYTES,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";
import type { Event } from "nostr-tools/pure";
import { getEnv } from "@/config/env";
import { relayHttpOrigin, signEvent } from "@/lib/buzz/relay-client";

export type MediaOwner =
  | { kind: "user"; userId: string }
  | { kind: "coworker"; coworkerId: string };

const MEDIA_PATH = /^\/media\/([0-9a-f]{64})(\.[a-z0-9]{1,10})?$/i;

/** The community's media files this event refers to, in its text or `imeta`. */
export function relayMediaUrls(event: Event, relayUrl: string): string[] {
  const origin = relayHttpOrigin(relayUrl);
  const candidates = [
    ...(event.content.match(/https?:\/\/[^\s)<>"\]]+/g) ?? []),
    ...event.tags.flatMap((tag) =>
      tag[0] === "imeta"
        ? tag
            .slice(1)
            .filter((part) => part.startsWith("url "))
            .map((part) => part.slice(4).trim())
        : [],
    ),
  ];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.origin === origin && MEDIA_PATH.test(url.pathname)) {
        urls.add(url.origin + url.pathname);
      }
    } catch {
      // not a URL
    }
  }
  return [...urls];
}

/** A Blossom `get` authorization for one file on one community host. */
function blossomGet(secretKey: Uint8Array, sha256: string, host: string) {
  const auth = signEvent(
    {
      kind: 24242,
      content: "Get blob",
      tags: [
        ["t", "get"],
        ["x", sha256],
        ["server", host],
        ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
      ],
    },
    secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(auth), "utf8").toString("base64")}`;
}

/**
 * Copies one relay file into Sokosumi's chat files; the public URL, or null
 * when it cannot (too large, refused, not what its name says).
 */
async function copyMedia(input: {
  url: string;
  eventId: string;
  readerKeys: Uint8Array[];
  owner: MediaOwner;
  roomId: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const url = new URL(input.url);
  const match = MEDIA_PATH.exec(url.pathname);
  if (!match?.[1]) return null;
  const sha256 = match[1].toLowerCase();
  for (const secretKey of input.readerKeys) {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: { authorization: blossomGet(secretKey, sha256, url.host) },
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 401 || response.status === 403) continue;
    // Not there (or not a file): it never will be. Anything else (the relay
    // or the network failing) is tried again with the event.
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) {
      throw new Error(
        `Buzz file ${sha256.slice(0, 8)}: HTTP ${response.status}`,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > CHAT_ROOM_FILE_MAX_SIZE_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > CHAT_ROOM_FILE_MAX_SIZE_BYTES) return null;
    // Content-addressed: anything else is not the file the message names.
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      return null;
    }
    // Per message: deleting one message deletes its copy, never another's.
    const fileName = `buzz-${input.eventId.slice(0, 16)}-${sha256.slice(0, 16)}${match[2] ?? ""}`;
    const pathname =
      input.owner.kind === "user"
        ? buildUserChatRoomFilePathname(
            input.owner.userId,
            input.roomId,
            fileName,
          )
        : buildCoworkerChatRoomFilePathname(
            input.owner.coworkerId,
            input.roomId,
            fileName,
          );
    // A replayed event writes the same blob again.
    const blob = await put(pathname, bytes, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      token,
    });
    return blob.url;
  }
  return null;
}

/**
 * The message's text with its relay files replaced by Sokosumi copies, and
 * any file only its `imeta` names added on its own line. A file that can
 * never be copied (refused, too large, not what its name says) keeps its
 * relay link; a failure that may pass throws, so the event is tried again.
 */
export async function withSokosumiMedia(input: {
  content: string;
  event: Event;
  relayUrl: string;
  readerKeys: Uint8Array[];
  owner: MediaOwner;
  roomId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  let content = input.content;
  for (const url of relayMediaUrls(input.event, input.relayUrl)) {
    // Throws when trying again may work (the event is then applied later).
    const copy = await copyMedia({ ...input, url, eventId: input.event.id });
    const shown = copy ?? url;
    content = content.includes(url)
      ? content.replaceAll(url, shown)
      : `${content}${content ? "\n" : ""}${shown}`;
  }
  return content;
}
