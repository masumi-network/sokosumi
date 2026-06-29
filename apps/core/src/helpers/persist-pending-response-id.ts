import prisma from "@/lib/db/prisma";

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_DELAYS_MS = [0, 150, 300, 600];

export interface PersistPendingResponseIdParams {
  conversationId: string;
  userId: string;
  responseId: string;
  coworkerSlug: string;
  coworkerId: string;
}

export interface PersistPendingResponseIdOptions {
  maxAttempts?: number;
  delaysMs?: number[];
}

export async function persistPendingResponseId(
  params: PersistPendingResponseIdParams,
  options: PersistPendingResponseIdOptions = {},
): Promise<void> {
  const { conversationId, userId, responseId, coworkerSlug, coworkerId } =
    params;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delaysMs = options.delaysMs ?? DEFAULT_DELAYS_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
          SELECT "metadata" FROM "conversation"
          WHERE "id" = ${conversationId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (rows.length === 0) {
          throw new Error("Conversation not found");
        }
        const meta = (rows[0]!.metadata as Record<string, unknown>) ?? {};
        const pending = meta.pending_responses_api_response_id;
        const previous = meta.previous_response_id;

        if (previous === responseId) return;
        if (pending === responseId) return;

        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            metadata: {
              ...meta,
              pending_responses_api_response_id: responseId,
              coworker_slug: coworkerSlug,
              coworker_id: coworkerId,
            },
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw (
    lastError ??
    new Error("Failed to persist pending response id after retries")
  );
}

export interface ClearPendingResponseIdParams {
  conversationId: string;
  userId: string;
}

export interface ClearPendingResponseIdOptions {
  maxAttempts?: number;
  delaysMs?: number[];
}

export async function clearPendingResponseId(
  params: ClearPendingResponseIdParams,
  options: ClearPendingResponseIdOptions = {},
): Promise<void> {
  const { conversationId, userId } = params;
  const maxAttempts = options.maxAttempts ?? 3;
  const delaysMs = options.delaysMs ?? [0, 150, 300];

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
          SELECT "metadata" FROM "conversation"
          WHERE "id" = ${conversationId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (rows.length === 0) {
          throw new Error("Conversation not found");
        }
        const currentMeta =
          (rows[0]!.metadata as Record<string, unknown>) ?? {};
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            metadata: {
              ...currentMeta,
              pending_responses_api_response_id: null,
            },
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw (
    lastError ?? new Error("Failed to clear pending response id after retries")
  );
}

export interface ClearPendingAndSetPreviousParams {
  conversationId: string;
  userId: string;
  responseId: string;
}

export interface ClearPendingAndSetPreviousOptions {
  maxAttempts?: number;
  delaysMs?: number[];
}

export async function clearPendingAndSetPrevious(
  params: ClearPendingAndSetPreviousParams,
  options: ClearPendingAndSetPreviousOptions = {},
): Promise<void> {
  const { conversationId, userId, responseId } = params;
  const maxAttempts = options.maxAttempts ?? 3;
  const delaysMs = options.delaysMs ?? [0, 150, 300];

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
          SELECT "metadata" FROM "conversation"
          WHERE "id" = ${conversationId} AND "userId" = ${userId}
          FOR UPDATE
        `;
        if (rows.length === 0) {
          throw new Error("Conversation not found");
        }
        const currentMeta =
          (rows[0]!.metadata as Record<string, unknown>) ?? {};
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            metadata: {
              ...currentMeta,
              previous_response_id: responseId,
              pending_responses_api_response_id: null,
            },
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw (
    lastError ?? new Error("Failed to clear pending response id after retries")
  );
}
