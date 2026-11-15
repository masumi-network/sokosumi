/**
 * One-time import of a room's history into its Buzz channel.
 *
 * The relay takes no event more than 15 minutes from its clock, so messages
 * written before a room reached Buzz cannot be sent. Sokosumi holds the key of
 * everyone who wrote them, so it signs each with its original time and writes
 * it straight into the relay's database (ours to run), the way the relay
 * stores an accepted event: the event, its thread counters, its mentions and
 * its reactions. `received_at` is the original time, so none of it shows as
 * unread. Nothing is pushed or announced: clients read history on demand.
 *
 * Every message gets the link the live bridge would have written, so an edit
 * or deletion later in Sokosumi reaches Buzz as usual. Safe to run again: a
 * message already linked is skipped and the relay ignores an event it has.
 */
import type pg from "pg";
import {
  BUZZ_AGENT_URL_PREFIX,
  contentHash,
  messageDraft,
  reactionDraft,
} from "@/lib/buzz/events";
import { signEvent } from "@/lib/buzz/relay-client";
import { relayDatabase } from "@/lib/buzz/relay-database";
import prisma from "@/lib/db/prisma";
import {
  authorOf,
  buzzContentOf,
  ensureIdentity,
  identitySecretKey,
  isExternal,
  isPersonalAgent,
  mentionPubkeysOf,
  vouched,
} from "@/services/buzz-bridge.service";

type Log = (message: string, extra?: unknown) => void;
type RelayClient = pg.PoolClient;

const BATCH = 200;

const at = (seconds: number) => new Date(seconds * 1000);
const hex = (value: string) => Buffer.from(value, "hex");

/**
 * Imports the history of up to `limit` channels that still need it. Returns
 * how many it finished. Does nothing without `BUZZ_RELAY_DATABASE_URL`.
 */
export async function importBuzzHistory(
  options: { limit?: number; log?: Log; shouldContinue?: () => boolean } = {},
): Promise<number> {
  const database = relayDatabase();
  if (!database) return 0;
  const channels = await prisma.buzzChannel.findMany({
    where: {
      historyImportedAt: null,
      roomId: { not: null },
      community: { provisionedAt: { not: null } },
    },
    select: {
      id: true,
      channelId: true,
      roomId: true,
      createdAt: true,
      community: { select: { relayUrl: true } },
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 3,
  });
  let finished = 0;
  for (const channel of channels) {
    if (options.shouldContinue?.() === false) break;
    const client = await database.connect();
    try {
      const imported = await importChannel(client, {
        channelId: channel.channelId,
        roomId: channel.roomId as string,
        // Everything before the room had its channel (a Direct may become
        // bridgeable long after its community existed); a message linked
        // already went out live and is skipped.
        before: channel.createdAt,
        host: new URL(channel.community.relayUrl).host,
        shouldContinue: options.shouldContinue,
      });
      if (imported === null) continue;
      await prisma.buzzChannel.update({
        where: { id: channel.id },
        data: { historyImportedAt: new Date() },
      });
      options.log?.(
        `history of room ${channel.roomId?.slice(0, 8)}: ${imported} message(s) imported`,
      );
      finished++;
    } finally {
      client.release();
    }
  }
  return finished;
}

/** Imports one channel's history; null when stopped before the end. */
async function importChannel(
  client: RelayClient,
  input: {
    channelId: string;
    roomId: string;
    before: Date;
    host: string;
    shouldContinue?: () => boolean;
  },
): Promise<number | null> {
  const community = await client.query<{ id: string }>(
    "SELECT id FROM communities WHERE lower(host) = lower($1) AND deleted_at IS NULL",
    [input.host],
  );
  const communityId = community.rows[0]?.id;
  if (!communityId) throw new Error(`No community ${input.host} on the relay`);

  let imported = 0;
  let after: { createdAt: Date; id: string } | null = null;
  for (;;) {
    if (input.shouldContinue?.() === false) return null;
    const messages: HistoryMessage[] = await prisma.chatRoomMessage.findMany({
      where: {
        roomId: input.roomId,
        createdAt: { lt: input.before },
        deletedAt: null,
        buzzLink: null,
        // Only what can be imported, so what never can is not scanned again
        // on every pass: authored, not empty, not a personal agent's (its
        // key is in its owner's Buzz app).
        content: { not: "" },
        OR: [
          { senderUserId: { not: null } },
          { senderSokoBotId: { not: null } },
          {
            senderCoworkerId: { not: null },
            senderCoworker: {
              NOT: { baseURL: { startsWith: BUZZ_AGENT_URL_PREFIX } },
            },
          },
        ],
        ...(after
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { gt: after.createdAt } },
                    { createdAt: after.createdAt, id: { gt: after.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        roomId: true,
        parentMessageId: true,
        content: true,
        createdAt: true,
        senderUserId: true,
        senderSokoBotId: true,
        senderCoworkerId: true,
        reactions: { select: { userId: true, emoji: true, createdAt: true } },
        userMentionsAsSource: { select: { userId: true } },
        mentionsAsSource: { select: { sokoBotId: true, coworkerId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: BATCH,
    });
    for (const message of messages) {
      // What is imported stays linked; the next pass goes on from there.
      if (input.shouldContinue?.() === false) return null;
      if (await importMessage(client, communityId, input.channelId, message)) {
        imported++;
      }
    }
    const last = messages.at(-1);
    if (!last || messages.length < BATCH) {
      await deleteUnlinkedCopies(client, communityId, input);
      return imported;
    }
    after = { createdAt: last.createdAt, id: last.id };
  }
}

type HistoryMessage = {
  id: string;
  roomId: string;
  parentMessageId: string | null;
  content: string;
  createdAt: Date;
  senderUserId: string | null;
  senderSokoBotId: string | null;
  senderCoworkerId: string | null;
  reactions: { userId: string; emoji: string; createdAt: Date }[];
  userMentionsAsSource: { userId: string }[];
  mentionsAsSource: { sokoBotId: string | null; coworkerId: string | null }[];
};

async function importMessage(
  client: RelayClient,
  communityId: string,
  channelId: string,
  message: HistoryMessage,
): Promise<boolean> {
  // Imported by an earlier pass that stopped before linking it: link that
  // event (never a second copy); the outbox brings it up to date.
  const earlier = await importedEventOf(
    client,
    communityId,
    channelId,
    message.id,
  );
  if (earlier) {
    const reactionLinks = await importedReactionsOf(
      client,
      communityId,
      earlier,
    );
    await prisma.$transaction([
      prisma.buzzMessageLink.create({
        data: {
          messageId: message.id,
          eventId: earlier,
          contentHash: "",
          channelId,
        },
      }),
      ...reactionLinks.map((link) =>
        prisma.buzzReactionLink.upsert({
          where: {
            messageId_identityId_emoji: {
              messageId: message.id,
              identityId: link.identityId,
              emoji: link.emoji,
            },
          },
          create: { messageId: message.id, ...link },
          update: {},
        }),
      ),
      // Brings the copy up to date (it may predate an edit or a reaction).
      prisma.buzzOutbox.create({
        data: { roomId: message.roomId, messageId: message.id },
      }),
    ]);
    return true;
  }
  const author = authorOf(message);
  // Timeline notices have no author; Buzz shows its own.
  if (!author || !message.content.trim()) return false;
  // A person's own Buzz agent signs with a key Sokosumi does not hold.
  if ("coworkerId" in author && (await isPersonalAgent(author.coworkerId))) {
    return false;
  }
  const identity = await ensureIdentity(author);
  // A key Sokosumi does not hold signed it on Buzz already.
  if (isExternal(identity)) return false;

  let root: { eventId: string; createdAt: number } | null = null;
  if (message.parentMessageId) {
    const parent = await prisma.buzzMessageLink.findUnique({
      where: { messageId: message.parentMessageId },
      select: { eventId: true, channelId: true },
    });
    // The parent was imported first (oldest first); a deleted one was not,
    // and its reply stands on its own, as live.
    if (parent && (!parent.channelId || parent.channelId === channelId)) {
      const stored = await client.query<{ created_at: Date }>(
        "SELECT created_at FROM events WHERE community_id = $1 AND id = $2",
        [communityId, hex(parent.eventId)],
      );
      const createdAt = stored.rows[0]?.created_at;
      if (createdAt) {
        root = {
          eventId: parent.eventId,
          createdAt: Math.floor(createdAt.getTime() / 1000),
        };
      }
    }
  }

  const event = signEvent(
    vouched(
      identity,
      messageDraft({
        channelId,
        content: await buzzContentOf(message.content),
        threadRootEventId: root?.eventId ?? null,
        mentionPubkeys: await mentionPubkeysOf(message),
        messageId: message.id,
        createdAt: message.createdAt,
      }),
    ),
    identitySecretKey(identity),
  );
  const reactions = [];
  for (const reaction of message.reactions) {
    const reactor = await ensureIdentity({ userId: reaction.userId });
    if (isExternal(reactor)) continue;
    reactions.push({
      identity: reactor,
      emoji: reaction.emoji,
      event: signEvent(
        {
          ...reactionDraft({
            channelId,
            eventId: event.id,
            authorPubkey: event.pubkey,
            emoji: reaction.emoji,
          }),
          created_at: Math.max(
            event.created_at,
            Math.floor(reaction.createdAt.getTime() / 1000),
          ),
        },
        identitySecretKey(reactor),
      ),
    });
  }

  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await insertEvent(client, communityId, channelId, event);
    if (root) {
      await insertReply(client, communityId, channelId, event, root);
    }
    for (const tag of event.tags) {
      if (tag[0] !== "p" || !tag[1]) continue;
      await client.query(
        `INSERT INTO event_mentions
           (community_id, pubkey_hex, event_id, event_created_at, channel_id, event_kind)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [
          communityId,
          tag[1],
          hex(event.id),
          at(event.created_at),
          channelId,
          event.kind,
        ],
      );
    }
    for (const reaction of reactions) {
      await insertEvent(client, communityId, channelId, reaction.event);
      await client.query(
        `INSERT INTO reactions
           (community_id, event_created_at, event_id, pubkey, emoji, created_at, reaction_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [
          communityId,
          at(event.created_at),
          hex(event.id),
          hex(reaction.event.pubkey),
          reaction.emoji,
          at(reaction.event.created_at),
          hex(reaction.event.id),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }

  // Linked after the relay has it, message and reactions together: a run
  // that stops in between finds the event on the relay next time and links
  // it then (see importedEventOf).
  await prisma.$transaction([
    prisma.buzzMessageLink.create({
      data: {
        messageId: message.id,
        eventId: event.id,
        contentHash: contentHash(message.content),
        channelId,
      },
    }),
    ...reactions.map((reaction) =>
      prisma.buzzReactionLink.upsert({
        where: {
          messageId_identityId_emoji: {
            messageId: message.id,
            identityId: reaction.identity.id,
            emoji: reaction.emoji,
          },
        },
        create: {
          messageId: message.id,
          identityId: reaction.identity.id,
          emoji: reaction.emoji,
          eventId: reaction.event.id,
        },
        update: {},
      }),
    ),
  ]);
  return true;
}

/** The event an earlier import wrote for this message, if any (its id). */
async function importedEventOf(
  client: RelayClient,
  communityId: string,
  channelId: string,
  messageId: string,
): Promise<string | null> {
  const found = await client.query<{ id: Buffer }>(
    `SELECT id FROM events
      WHERE community_id = $1 AND channel_id = $2 AND kind = 9
        AND tags @> $3::jsonb
      LIMIT 1`,
    [communityId, channelId, JSON.stringify([["sokosumi", messageId]])],
  );
  return found.rows[0]?.id.toString("hex") ?? null;
}

/**
 * Every reaction an earlier import wrote for this message, as links, read
 * from the relay: one removed in Sokosumi meanwhile is linked too, so the
 * outbox takes it back on Buzz.
 */
async function importedReactionsOf(
  client: RelayClient,
  communityId: string,
  eventId: string,
) {
  const found = await client.query<{
    id: Buffer;
    pubkey: Buffer;
    content: string;
  }>(
    `SELECT id, pubkey, content FROM events
      WHERE community_id = $1 AND kind = 7 AND deleted_at IS NULL
        AND tags @> $2::jsonb`,
    [communityId, JSON.stringify([["e", eventId]])],
  );
  const links: { identityId: string; emoji: string; eventId: string }[] = [];
  for (const row of found.rows) {
    const identity = await prisma.buzzIdentity.findUnique({
      where: { pubkey: row.pubkey.toString("hex") },
      select: { id: true },
    });
    if (identity) {
      links.push({
        identityId: identity.id,
        emoji: row.content,
        eventId: row.id.toString("hex"),
      });
    }
  }
  return links;
}

/**
 * Messages deleted after an interrupted import wrote them, before it linked
 * them: nothing else knows their copy on Buzz, so it is deleted here.
 */
async function deleteUnlinkedCopies(
  client: RelayClient,
  communityId: string,
  input: { channelId: string; roomId: string; before: Date },
) {
  const deleted = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: input.roomId,
      createdAt: { lt: input.before },
      deletedAt: { not: null },
      buzzLink: null,
    },
    select: { id: true },
  });
  for (const message of deleted) {
    await client.query(
      `UPDATE events SET deleted_at = now()
        WHERE community_id = $1 AND channel_id = $2 AND kind = 9
          AND deleted_at IS NULL AND tags @> $3::jsonb`,
      [
        communityId,
        input.channelId,
        JSON.stringify([["sokosumi", message.id]]),
      ],
    );
  }
}

async function insertEvent(
  client: RelayClient,
  communityId: string,
  channelId: string,
  event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  },
) {
  await client.query(
    `INSERT INTO events
       (community_id, id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $4, $9)
     ON CONFLICT DO NOTHING`,
    [
      communityId,
      hex(event.id),
      hex(event.pubkey),
      at(event.created_at),
      event.kind,
      JSON.stringify(event.tags),
      event.content,
      hex(event.sig),
      channelId,
    ],
  );
}

/**
 * A reply's thread row, and its root's counters, as the relay keeps them
 * (one level deep, as Sokosumi threads are).
 */
async function insertReply(
  client: RelayClient,
  communityId: string,
  channelId: string,
  event: { id: string; created_at: number },
  root: { eventId: string; createdAt: number },
) {
  const inserted = await client.query(
    `INSERT INTO thread_metadata
       (community_id, event_created_at, event_id, channel_id,
        parent_event_id, parent_event_created_at, root_event_id, root_event_created_at,
        depth, broadcast)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 1, false)
     ON CONFLICT DO NOTHING`,
    [
      communityId,
      at(event.created_at),
      hex(event.id),
      channelId,
      hex(root.eventId),
      at(root.createdAt),
    ],
  );
  if (inserted.rowCount === 0) return;
  await client.query(
    `INSERT INTO thread_metadata
       (community_id, event_created_at, event_id, channel_id, depth, broadcast)
     VALUES ($1, $2, $3, $4, 0, false) ON CONFLICT DO NOTHING`,
    [communityId, at(root.createdAt), hex(root.eventId), channelId],
  );
  await client.query(
    `UPDATE thread_metadata
        SET reply_count = reply_count + 1,
            descendant_count = descendant_count + 1,
            last_reply_at = GREATEST(COALESCE(last_reply_at, $3), $3)
      WHERE community_id = $1 AND event_id = $2`,
    [communityId, hex(root.eventId), at(event.created_at)],
  );
}
