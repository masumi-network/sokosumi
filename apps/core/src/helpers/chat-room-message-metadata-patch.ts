import prisma from "@/lib/db/prisma";

export interface ChatRoomMessageMetadataPatchGuard {
  messageId: string;
  /**
   * When set, update only if content still matches (unfurl stale-edit guard).
   */
  contentMustEqual?: string;
  /** Skip soft-deleted rows. Default true. */
  requireNotDeleted?: boolean;
}

/**
 * Atomically merge top-level JSON object keys into `chat_room_message.metadata`
 * via Postgres `jsonb ||`, so concurrent writers (unfurl scrape vs thread
 * provider conversation id) cannot clobber each other's keys.
 *
 * Returns the number of rows updated (0 or 1).
 */
export async function mergeChatRoomMessageMetadataKeys(
  options: ChatRoomMessageMetadataPatchGuard & {
    patch: Record<string, unknown>;
  },
): Promise<number> {
  const {
    messageId,
    patch,
    contentMustEqual,
    requireNotDeleted = true,
  } = options;
  const patchJson = JSON.stringify(patch);

  if (contentMustEqual !== undefined && requireNotDeleted) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${patchJson}::jsonb
      WHERE id = ${messageId}::uuid
        AND "deletedAt" IS NULL
        AND content = ${contentMustEqual}
    `;
  }

  if (contentMustEqual !== undefined) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${patchJson}::jsonb
      WHERE id = ${messageId}::uuid
        AND content = ${contentMustEqual}
    `;
  }

  if (requireNotDeleted) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${patchJson}::jsonb
      WHERE id = ${messageId}::uuid
        AND "deletedAt" IS NULL
    `;
  }

  return prisma.$executeRaw`
    UPDATE "chat_room_message"
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${patchJson}::jsonb
    WHERE id = ${messageId}::uuid
  `;
}

/**
 * Atomically delete top-level metadata keys via Postgres `jsonb - text[]`.
 * Empty objects collapse to NULL to match prior Prisma merge helpers.
 *
 * Returns the number of rows updated (0 or 1).
 */
export async function deleteChatRoomMessageMetadataKeys(
  options: ChatRoomMessageMetadataPatchGuard & {
    keys: readonly string[];
  },
): Promise<number> {
  const {
    messageId,
    keys,
    contentMustEqual,
    requireNotDeleted = true,
  } = options;

  if (keys.length === 0) {
    return 0;
  }

  const keyArray = [...keys];

  if (contentMustEqual !== undefined && requireNotDeleted) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = NULLIF(
        COALESCE(metadata, '{}'::jsonb) - ${keyArray}::text[],
        '{}'::jsonb
      )
      WHERE id = ${messageId}::uuid
        AND "deletedAt" IS NULL
        AND content = ${contentMustEqual}
    `;
  }

  if (contentMustEqual !== undefined) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = NULLIF(
        COALESCE(metadata, '{}'::jsonb) - ${keyArray}::text[],
        '{}'::jsonb
      )
      WHERE id = ${messageId}::uuid
        AND content = ${contentMustEqual}
    `;
  }

  if (requireNotDeleted) {
    return prisma.$executeRaw`
      UPDATE "chat_room_message"
      SET metadata = NULLIF(
        COALESCE(metadata, '{}'::jsonb) - ${keyArray}::text[],
        '{}'::jsonb
      )
      WHERE id = ${messageId}::uuid
        AND "deletedAt" IS NULL
    `;
  }

  return prisma.$executeRaw`
    UPDATE "chat_room_message"
    SET metadata = NULLIF(
      COALESCE(metadata, '{}'::jsonb) - ${keyArray}::text[],
      '{}'::jsonb
    )
    WHERE id = ${messageId}::uuid
  `;
}
