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

/**
 * Persists pending Responses API response id (and coworker slug/id) to conversation
 * metadata with retries and exponential backoff. Skips write if already superseded
 * (completed or already written).
 */
export async function persistPendingResponseId(
  params: PersistPendingResponseIdParams,
  options: PersistPendingResponseIdOptions = {},
): Promise<void> {
  const { conversationId, userId, responseId, coworkerSlug, coworkerId } =
    params;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delaysMs = options.delaysMs ?? DEFAULT_DELAYS_MS;

  let _lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { metadata: true },
      });
      if (!conv) {
        _lastError = new Error("Conversation not found");
        continue;
      }
      const meta = (conv.metadata as Record<string, unknown>) ?? {};
      const pending = meta.pending_responses_api_response_id;
      const previous = meta.previous_response_id;

      if (previous === responseId) return;
      if (pending === responseId) return;

      await prisma.conversation.update({
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
      return;
    } catch (error) {
      _lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
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

/**
 * Clears pending_responses_api_response_id and sets previous_response_id on
 * conversation metadata, with retries. Used when a response completes.
 */
export async function clearPendingAndSetPrevious(
  params: ClearPendingAndSetPreviousParams,
  options: ClearPendingAndSetPreviousOptions = {},
): Promise<void> {
  const { conversationId, userId, responseId } = params;
  const maxAttempts = options.maxAttempts ?? 3;
  const delaysMs = options.delaysMs ?? [0, 150, 300];

  let _lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: { metadata: true },
      });
      if (!conv) {
        _lastError = new Error("Conversation not found");
        continue;
      }
      const currentMeta = (conv.metadata as Record<string, unknown>) ?? {};
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          metadata: {
            ...currentMeta,
            previous_response_id: responseId,
            pending_responses_api_response_id: null,
          },
        },
      });
      return;
    } catch (error) {
      _lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}
