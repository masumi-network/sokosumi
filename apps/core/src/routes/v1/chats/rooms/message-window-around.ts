import type { Prisma } from "@sokosumi/database";

import { chatRoomMessageInclude } from "./helpers";

type ChatRoomMessageWithSender = Prisma.ChatRoomMessageGetPayload<{
  include: typeof chatRoomMessageInclude;
}>;

interface ChatRoomMessageReadClient {
  chatRoomMessage: {
    findMany: Prisma.TransactionClient["chatRoomMessage"]["findMany"];
    count: Prisma.TransactionClient["chatRoomMessage"]["count"];
  };
}

interface ListChatRoomMessagesAroundOptions {
  db: ChatRoomMessageReadClient;
  scope: Prisma.ChatRoomMessageWhereInput;
  center: ChatRoomMessageWithSender;
  take: number;
}

function createdAtIdSide(
  createdAt: Date,
  id: string,
  side: "older" | "newer",
): Prisma.ChatRoomMessageWhereInput {
  if (side === "older") {
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { AND: [{ createdAt }, { id: { lt: id } }] },
      ],
    };
  }
  return {
    OR: [
      { createdAt: { gt: createdAt } },
      { AND: [{ createdAt }, { id: { gt: id } }] },
    ],
  };
}

function trimCentered<T>(
  items: readonly T[],
  centerIndex: number,
  take: number,
): T[] {
  if (items.length <= take) {
    return [...items];
  }
  const idealStart = Math.max(0, centerIndex - Math.floor((take - 1) / 2));
  const start = Math.min(idealStart, items.length - take);
  return items.slice(start, start + take);
}

/**
 * Contiguous reading-order window (oldest → newest) centred on `center`.
 * `hasMoreOlder` is true when Load older from this window would return rows.
 */
export async function listChatRoomMessagesAround({
  db,
  scope,
  center,
  take,
}: ListChatRoomMessagesAroundOptions): Promise<{
  messages: ChatRoomMessageWithSender[];
  hasMoreOlder: boolean;
  count: number;
}> {
  const takePlusOne = take + 1;
  const [olderPlus, newer, count] = await Promise.all([
    db.chatRoomMessage.findMany({
      where: {
        AND: [scope, createdAtIdSide(center.createdAt, center.id, "older")],
      },
      take: takePlusOne,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: chatRoomMessageInclude,
    }),
    db.chatRoomMessage.findMany({
      where: {
        AND: [scope, createdAtIdSide(center.createdAt, center.id, "newer")],
      },
      take,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: chatRoomMessageInclude,
    }),
    db.chatRoomMessage.count({ where: scope }),
  ]);

  const hasMoreOlderFromFetch = olderPlus.length === takePlusOne;
  const olderClosest = olderPlus.slice(0, take);
  const assembled = [...olderClosest].reverse().concat(center, newer);
  const centerIndex = assembled.findIndex((row) => row.id === center.id);
  const messages = trimCentered(
    assembled,
    centerIndex < 0 ? 0 : centerIndex,
    take,
  );
  const droppedOlder =
    messages[0] != null &&
    assembled[0] != null &&
    messages[0].id !== assembled[0].id;
  const hasMoreOlder = droppedOlder || hasMoreOlderFromFetch;

  return { messages, hasMoreOlder, count };
}

export function aroundWindowPaginationMeta(
  messages: ReadonlyArray<{ id: string }>,
  take: number,
  count: number,
  hasMoreOlder: boolean,
): {
  cursor: null;
  limit: number;
  total: number;
  nextCursor: string | null;
} {
  return {
    cursor: null,
    limit: take,
    total: count,
    nextCursor: hasMoreOlder ? (messages[0]?.id ?? null) : null,
  };
}
