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
  CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH,
  findMarkdownLinks,
  isFileLikeUrl,
  unescapeMarkdownLinkUrl,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";
import type { Event } from "nostr-tools/pure";
import { getEnv } from "@/config/env";
import { relayHttpOrigin, signEvent } from "@/lib/buzz/relay-client";

/** A file copied from Buzz, as a Coworker's stream takes it. */
export type CopiedFile = { url: string; mediaType: string; filename: string };

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

/** A Blossom authorization for one file on one community host. */
function blossomAuth(
  verb: "get" | "upload",
  secretKey: Uint8Array,
  sha256: string,
  host: string,
) {
  const auth = signEvent(
    {
      kind: 24242,
      content: verb === "get" ? "Get blob" : "Upload file",
      tags: [
        ["t", verb],
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
  copied?: CopiedFile[];
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
      headers: {
        authorization: blossomAuth("get", secretKey, sha256, url.host),
      },
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
    input.copied?.push({
      url: blob.url,
      mediaType:
        response.headers.get("content-type") ?? "application/octet-stream",
      filename: fileName,
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
  /** Collects the files copied, for a Coworker's stream. */
  copied?: CopiedFile[];
  content: string;
  event: Event;
  relayUrl: string;
  readerKeys: Uint8Array[];
  owner: MediaOwner;
  roomId: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  let content = input.content;
  const names = imetaFileNames(input.event);
  for (const url of relayMediaUrls(input.event, input.relayUrl)) {
    // Throws when trying again may work (the event is then applied later).
    const copy = await copyMedia({ ...input, url, eventId: input.event.id });
    const shown = copy ?? url;
    const named = names.get(url);
    // Buzz writes a file as `![name](<url>)` (or without the `!`); Sokosumi
    // shows a link to a file on a line of its own as the file.
    const written = new RegExp(
      `!?\\[((?:\\\\.|[^\\]\\\\\\n])*)\\]\\(<?${escapeRegExp(url)}>?\\)`,
      "g",
    );
    if (written.test(content)) {
      content = content.replace(
        written,
        (_, label: string) =>
          `[${fileLabel(named ?? unescapeMarkdown(label), shown)}](${shown})`,
      );
    } else if (content.includes(url)) {
      content = content.replaceAll(url, shown);
    } else {
      content = `${content}${content ? "\n\n" : ""}[${fileLabel(named, shown)}](${shown})`;
    }
  }
  return content;
}

/** Each relay file's name as its `imeta` gives it. */
function imetaFileNames(event: Event): Map<string, string> {
  const names = new Map<string, string>();
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const field = (key: string) =>
      tag.find((part) => part.startsWith(`${key} `))?.slice(key.length + 1);
    const url = field("url")?.trim();
    const name = field("filename")?.trim();
    if (!url || !name) continue;
    try {
      const parsed = new URL(url);
      names.set(parsed.origin + parsed.pathname, name);
    } catch {
      // not a URL
    }
  }
  return names;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeMarkdown(value: string) {
  return value.replace(/\\([\\`*_{}[\]()#+\-.!<>&|~])/g, "$1");
}

/** A name a Markdown link label can hold, or the file's own name. */
function fileLabel(name: string | undefined, url: string) {
  const cleaned = name?.replace(/[[\]\r\n]/g, " ").trim();
  return (
    cleaned ||
    decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file")
  );
}

/**
 * Buzz takes longer messages than Sokosumi. One that does not fit keeps what
 * fits, and its whole text goes into the author's chat files, linked at the
 * end, so nothing is lost.
 */
export async function fitToSokosumi(input: {
  content: string;
  eventId: string;
  owner: MediaOwner;
  roomId: string;
}): Promise<string> {
  if (input.content.length <= CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH) {
    return input.content;
  }
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  const note = (link: string) => `\n\n… [The whole message](${link})`;
  if (!token) {
    const cut = "\n\n… (shortened: the whole message is in Buzz)";
    return (
      input.content.slice(
        0,
        CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH - cut.length,
      ) + cut
    );
  }
  const fileName = `buzz-${input.eventId.slice(0, 16)}-message.md`;
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
  const blob = await put(pathname, input.content, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/markdown; charset=utf-8",
    token,
  });
  const tail = note(blob.url);
  return (
    input.content.slice(0, CHAT_ROOM_MESSAGE_CONTENT_MAX_LENGTH - tail.length) +
    tail
  );
}

/** A Buzz message's text and the `imeta` tags of the files it carries. */
export type BuzzAttachments = { content: string; attachments: string[][] };

/** Files Buzz shows inline; others are shown as a file to open. */
const INLINE_MEDIA = /^(image\/(png|jpeg|gif|webp)|video\/mp4)$/;
/** Sokosumi's chat files: its own public Blob store, never any other host. */
const CHAT_FILE_HOST = /\.public\.blob\.vercel-storage\.com$/;
const CHAT_FILE_PATH = /^\/(users|coworkers)\/[^/]+\/chats\//;

/**
 * Sokosumi's chat files in a message, uploaded to the community's relay as
 * the author, so Buzz shows them as its own attachments: written the way the
 * Buzz app writes them, with their `imeta`. A file the relay refuses (too
 * large, a type it does not take) stays a link; a failure that may pass
 * throws, so the change is tried again.
 */
export async function withRelayMedia(input: {
  content: string;
  relayUrl: string;
  secretKey: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<BuzzAttachments> {
  const send = input.fetchImpl ?? fetch;
  const origin = relayHttpOrigin(input.relayUrl);
  let content = input.content;
  const attachments: string[][] = [];
  const seen = new Set<string>();
  for (const link of findMarkdownLinks(input.content)) {
    const url = unescapeMarkdownLinkUrl(link.rawUrl);
    if (seen.has(url) || !isChatFile(url)) continue;
    seen.add(url);
    const file = await send(url, { signal: AbortSignal.timeout(60_000) });
    if (file.status === 404) continue;
    if (!file.ok) throw new Error(`Chat file: HTTP ${file.status}`);
    const declared = Number(file.headers.get("content-length") ?? 0);
    if (declared > CHAT_ROOM_FILE_MAX_SIZE_BYTES) {
      await file.body?.cancel();
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length > CHAT_ROOM_FILE_MAX_SIZE_BYTES) {
      continue;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const type =
      file.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream";
    const response = await send(`${origin}/upload`, {
      method: "PUT",
      headers: {
        authorization: blossomAuth(
          "upload",
          input.secretKey,
          sha256,
          new URL(origin).host,
        ),
        "content-type": type,
        "x-sha-256": sha256,
      },
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    // Refused for what the file is: it stays a link.
    if ([400, 401, 403, 413, 415, 422].includes(response.status)) continue;
    if (!response.ok) throw new Error(`Buzz upload: HTTP ${response.status}`);
    const uploaded = (await response.json()) as {
      url?: unknown;
      type?: unknown;
      size?: unknown;
      sha256?: unknown;
      dim?: unknown;
    };
    if (
      typeof uploaded.url !== "string" ||
      new URL(uploaded.url).origin !== origin ||
      uploaded.sha256 !== sha256
    ) {
      throw new Error("Buzz upload: unexpected answer");
    }
    const mediaType = typeof uploaded.type === "string" ? uploaded.type : type;
    const name = buzzLabel(link.text);
    content = content.replace(
      link.match,
      `${INLINE_MEDIA.test(mediaType) ? "!" : ""}[${name}](<${uploaded.url}>)`,
    );
    attachments.push([
      "imeta",
      `url ${uploaded.url}`,
      `m ${mediaType}`,
      `size ${bytes.length}`,
      `x ${sha256}`,
      `filename ${link.text.replace(/[\r\n]/g, " ").trim() || "file"}`,
      ...(typeof uploaded.dim === "string" ? [`dim ${uploaded.dim}`] : []),
    ]);
  }
  return { content, attachments };
}

function isChatFile(url: string): boolean {
  if (!isFileLikeUrl(url)) return false;
  const parsed = new URL(url);
  return (
    parsed.protocol === "https:" &&
    CHAT_FILE_HOST.test(parsed.hostname) &&
    CHAT_FILE_PATH.test(parsed.pathname)
  );
}

/** A file name as the Buzz app escapes it in a link label. */
function buzzLabel(name: string) {
  return Array.from(name, (char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .replace(/[\\`*_{}[\]()!<>&]/g, "\\$&");
}
