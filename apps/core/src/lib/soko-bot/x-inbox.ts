import type { Prisma } from "@sokosumi/database";
import type {
  SokoBotInboxMessage,
  SokoBotInboxMessageDetail,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";

/**
 * A personal Soko Bot's X direct messages of the last day. Contact capture is
 * the only reader of X DMs (X bills every event it returns); it keeps the new
 * ones here, on the bot's own X connection, and the hourly ingest, the
 * stand-up and search_inbox read them from here.
 */
export const X_INBOX_PROVIDER = "twitter";
const KEEP_MS = 26 * 60 * 60 * 1_000;
const MAX_ENTRIES = 200;
const TEXT_LENGTH = 1_000;
const SNIPPET_LENGTH = 300;

export interface XInboxEntry {
  id: string;
  conversationId: string;
  /** "Name (@username)", or "@username". */
  from: string;
  createdAt: string;
  text: string;
  /** The owner wrote it: shows they answered, never shown as a message. */
  fromOwner: boolean;
}

interface XInboxCursor {
  xDms?: XInboxEntry[];
  /** Entries the ingest already showed the bot. */
  xSeenIds?: string[];
}

function cursorOf(value: Prisma.JsonValue | null): XInboxCursor {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XInboxCursor)
    : {};
}

export function xInboxEntries(cursor: Prisma.JsonValue | null): XInboxEntry[] {
  return Array.isArray(cursorOf(cursor).xDms)
    ? (cursorOf(cursor).xDms ?? [])
    : [];
}

export function xInboxSeenIds(cursor: Prisma.JsonValue | null): Set<string> {
  const ids = cursorOf(cursor).xSeenIds;
  return new Set(Array.isArray(ids) ? ids : []);
}

/** Changes the connection's cursor under a row lock: capture and ingest both write it. */
async function updateCursor(
  integrationId: string,
  change: (cursor: XInboxCursor) => XInboxCursor,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ cursor: Prisma.JsonValue | null }[]>`
      SELECT "cursor" FROM "soko_bot_integration"
      WHERE "id" = ${integrationId}::uuid FOR UPDATE`;
    if (!row) return;
    await tx.sokoBotIntegration.update({
      where: { id: integrationId },
      data: {
        cursor: JSON.parse(
          JSON.stringify(change(cursorOf(row.cursor))),
        ) as Prisma.InputJsonObject,
      },
    });
  });
}

/** Adds what capture read; keeps the last day, newest first. */
export async function keepXDms(
  integrationId: string,
  entries: readonly XInboxEntry[],
  now: Date,
): Promise<void> {
  const floor = now.getTime() - KEEP_MS;
  const fresh = entries.filter(
    (entry) => new Date(entry.createdAt).getTime() >= floor,
  );
  if (fresh.length === 0) return;
  await updateCursor(integrationId, (cursor) => {
    const byId = new Map<string, XInboxEntry>();
    for (const entry of [...fresh, ...(cursor.xDms ?? [])])
      if (!byId.has(entry.id) && new Date(entry.createdAt).getTime() >= floor)
        byId.set(entry.id, {
          ...entry,
          text: entry.text.slice(0, TEXT_LENGTH),
        });
    const xDms = [...byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ENTRIES);
    const kept = new Set(xDms.map((entry) => entry.id));
    return {
      ...cursor,
      xDms,
      xSeenIds: (cursor.xSeenIds ?? []).filter((id) => kept.has(id)),
    };
  });
}

/** Records which entries the bot was shown. */
export async function markXDmsSeen(
  integrationId: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await updateCursor(integrationId, (cursor) => ({
    ...cursor,
    xSeenIds: [...new Set([...(cursor.xSeenIds ?? []), ...ids])],
  }));
}

/**
 * The DMs others wrote, newest first, as inbox messages. One the owner
 * answered later in the same conversation carries `repliedAt`.
 */
export function xInboxMessages(
  entries: readonly XInboxEntry[],
  since?: Date,
): SokoBotInboxMessage[] {
  const lastReply = new Map<string, string>();
  for (const entry of entries)
    if (
      entry.fromOwner &&
      entry.createdAt > (lastReply.get(entry.conversationId) ?? "")
    )
      lastReply.set(entry.conversationId, entry.createdAt);
  return entries
    .filter(
      (entry) =>
        !entry.fromOwner && (!since || new Date(entry.createdAt) > since),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => {
      const last = lastReply.get(entry.conversationId);
      const reply = last && last > entry.createdAt ? last : null;
      return {
        provider: X_INBOX_PROVIDER,
        id: entry.id,
        threadId: entry.conversationId,
        from: entry.from,
        to: [],
        subject: "X DM",
        snippet: entry.text.slice(0, SNIPPET_LENGTH),
        receivedAt: entry.createdAt,
        unread: !reply,
        labels: ["X_DM"],
        ...(reply ? { repliedAt: reply } : {}),
      };
    });
}

export function xInboxMessageDetail(
  entries: readonly XInboxEntry[],
  id: string,
): SokoBotInboxMessageDetail | null {
  const entry = entries.find((candidate) => candidate.id === id);
  const message = xInboxMessages(entries).find((m) => m.id === id);
  if (!entry || !message) return null;
  return { ...message, body: entry.text, attachments: [] };
}
