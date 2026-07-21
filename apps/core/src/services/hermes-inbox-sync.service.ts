import * as Sentry from "@sentry/node";
import type { Orchestrator, Prisma } from "@sokosumi/database";
import { v5 as uuidv5 } from "uuid";

import {
  ackInstanceInbox,
  getInstanceInbox,
  type HermesInboxMessage,
  HermesOrchestratorError,
} from "@/clients/hermes-orchestrator.client";
import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

const HOT_LOOKBACK_MS = 10 * 60_000;
const WARM_LOOKBACK_MS = 60 * 60_000;
const HOT_POLL_INTERVAL_MS = 60_000;
const WARM_POLL_INTERVAL_MS = 2 * 60_000;
const COLD_POLL_INTERVAL_MS = 10 * 60_000;
const POLL_BATCH_LIMIT = 100;
const INBOX_FETCH_LIMIT = 50;
const INBOX_SINCE_OVERLAP_MS = 5 * 60_000;
const HERMES_INBOX_MESSAGE_UUID_NAMESPACE =
  "3ed84820-2c89-4546-9a58-96b20f8b4980";

/**
 * Outage-alert thresholds for the batch poll. We only escalate transient
 * orchestrator failures to Sentry when they dominate a non-trivial batch —
 * the signature of an actual orchestrator outage. A single 502 among
 * otherwise-healthy polls self-heals on the next cycle and must not alert.
 */
const OUTAGE_MIN_POLLED_FOR_ALERT = 5;
const OUTAGE_TRANSIENT_RATIO = 0.5;

/**
 * Returns true for errors that represent transient external-service failures
 * (Hermes orchestrator 5xx responses, network connect timeouts, etc.) that are
 * expected to self-resolve on the next poll cycle. These should NOT be reported
 * to Sentry per-user — doing so creates one event per affected user per minute
 * when the orchestrator is down, which drowns out actionable signal.
 */
export function isTransientOrchestratorError(error: unknown): boolean {
  if (error instanceof HermesOrchestratorError && error.httpStatus >= 500) {
    return true;
  }
  // Node's undici raises TypeError("fetch failed") wrapping a ConnectTimeoutError,
  // ResetConnectionError, etc. when the upstream host is unreachable.
  if (
    error instanceof TypeError &&
    error.message === "fetch failed" &&
    error.cause instanceof Error
  ) {
    return true;
  }
  return false;
}

interface SyncOptions {
  abortSignal: AbortSignal;
  deadlineMs: number;
  shouldContinue: () => boolean;
}

interface PollOutcome {
  userId: string;
  outcome:
    | "messages"
    | "no_messages"
    | "skipped_not_implemented"
    | "skipped_not_pollable"
    | "skipped_instance_missing"
    | "error";
  count?: number;
  status?: string;
  /** Set when outcome is "error" due to a transient external-service failure (5xx, network timeout). */
  transientError?: unknown;
}

export interface HermesInboxSyncSummary {
  status: "disabled" | "ok";
  polled: number;
  totalMessages: number;
  breakdown: Record<PollOutcome["outcome"], number>;
}

function createEmptyBreakdown(): HermesInboxSyncSummary["breakdown"] {
  return {
    messages: 0,
    no_messages: 0,
    skipped_not_implemented: 0,
    skipped_not_pollable: 0,
    skipped_instance_missing: 0,
    error: 0,
  };
}

/** Latest inbox instant for cursor updates; does not assume orchestrator sort order. */
function maxInboxMessageCreatedAt(messages: HermesInboxMessage[]): Date {
  let latest = new Date(messages[0]!.createdAt);
  for (let i = 1; i < messages.length; i++) {
    const candidate = new Date(messages[i]!.createdAt);
    if (candidate.getTime() > latest.getTime()) latest = candidate;
  }
  return latest;
}

function shouldContinueSync(options: SyncOptions): boolean {
  return (
    options.shouldContinue() &&
    !options.abortSignal.aborted &&
    Date.now() < options.deadlineMs
  );
}

function inboxSinceIso(lastInboxMessageAt: Date | null): string | null {
  if (!lastInboxMessageAt) return null;

  // The orchestrator treats `since` like a cursor and message timestamps can
  // reflect turn start, so overlap defensively and rely on idempotent upserts.
  const overlappedMs = Math.max(
    0,
    lastInboxMessageAt.getTime() - INBOX_SINCE_OVERLAP_MS,
  );
  return new Date(overlappedMs).toISOString();
}

function inboxMessageId(userId: string, orchestratorMessageId: string): string {
  return uuidv5(
    `${userId}:${orchestratorMessageId}`,
    HERMES_INBOX_MESSAGE_UUID_NAMESPACE,
  );
}

function markPolled(args: {
  userId: string;
  lastInboxMessageAt?: Date | null;
  resetErrors?: boolean;
  incrementErrors?: boolean;
}): Promise<void> {
  const data: Prisma.OrchestratorUpdateInput = {
    lastPolledAt: new Date(),
  };

  if (args.lastInboxMessageAt !== undefined) {
    data.lastInboxMessageAt = args.lastInboxMessageAt;
  }

  if (args.resetErrors) {
    data.consecutivePollErrors = 0;
  }

  if (args.incrementErrors) {
    data.consecutivePollErrors = { increment: 1 };
  }

  return prisma.orchestrator
    .updateMany({
      where: { userId: args.userId, archivedAt: null },
      data,
    })
    .then(() => undefined);
}

async function findDueForPoll(nowMs: number): Promise<Orchestrator[]> {
  return await prisma.orchestrator.findMany({
    where: {
      archivedAt: null,
      OR: [
        {
          lastInboxMessageAt: { gt: new Date(nowMs - HOT_LOOKBACK_MS) },
          OR: [
            { lastPolledAt: null },
            { lastPolledAt: { lt: new Date(nowMs - HOT_POLL_INTERVAL_MS) } },
          ],
        },
        {
          lastInboxMessageAt: {
            gt: new Date(nowMs - WARM_LOOKBACK_MS),
            lte: new Date(nowMs - HOT_LOOKBACK_MS),
          },
          OR: [
            { lastPolledAt: null },
            { lastPolledAt: { lt: new Date(nowMs - WARM_POLL_INTERVAL_MS) } },
          ],
        },
        {
          OR: [
            { lastInboxMessageAt: null },
            { lastInboxMessageAt: { lte: new Date(nowMs - WARM_LOOKBACK_MS) } },
          ],
          AND: {
            OR: [
              { lastPolledAt: null },
              {
                lastPolledAt: { lt: new Date(nowMs - COLD_POLL_INTERVAL_MS) },
              },
            ],
          },
        },
      ],
    },
    orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }],
    take: POLL_BATCH_LIMIT,
  });
}

async function persistInboxMessages(
  userId: string,
  messages: HermesInboxMessage[],
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const message of messages) {
      const id = inboxMessageId(userId, message.id);
      await tx.hermesMessage.upsert({
        where: { id },
        create: {
          id,
          userId,
          role: "assistant",
          content: message.content,
          kind: message.kind ?? "text",
          createdAt: new Date(message.createdAt),
        },
        update: {},
      });
    }
  });
}

async function pollOne(
  instance: Orchestrator,
  options: SyncOptions,
): Promise<PollOutcome> {
  const sinceIso = inboxSinceIso(instance.lastInboxMessageAt);

  let result: Awaited<ReturnType<typeof getInstanceInbox>>;
  try {
    result = await getInstanceInbox(instance.userId, {
      sinceIso,
      limit: INBOX_FETCH_LIMIT,
      signal: options.abortSignal,
    });
  } catch (error) {
    const transient = isTransientOrchestratorError(error);
    // Transient external-service failures (5xx, network timeout) are reported
    // once per batch by pollInboxes rather than once per affected user.
    if (!transient) {
      Sentry.captureException(error, {
        tags: { context: "hermes_inbox_poll" },
        extra: { userId: instance.userId },
      });
    }
    await markPolled({ userId: instance.userId, incrementErrors: true }).catch(
      () => undefined,
    );
    return {
      userId: instance.userId,
      outcome: "error",
      ...(transient && { transientError: error }),
    };
  }

  if (result.kind === "not_implemented") {
    await markPolled({ userId: instance.userId, resetErrors: true }).catch(
      () => undefined,
    );
    return { userId: instance.userId, outcome: "skipped_not_implemented" };
  }

  if (result.kind === "instance_missing") {
    // Do not wipe chat history from a poll signal — only archive so the
    // instance stops being polled. Explicit purge is POST /orchestrators/me/purge.
    await prisma.orchestrator
      .updateMany({
        where: { userId: instance.userId, archivedAt: null },
        data: {
          archivedAt: new Date(),
          lastPolledAt: null,
          consecutivePollErrors: 0,
        },
      })
      .catch(() => undefined);
    return { userId: instance.userId, outcome: "skipped_instance_missing" };
  }

  if (result.kind === "instance_not_pollable") {
    await markPolled({ userId: instance.userId, resetErrors: true }).catch(
      () => undefined,
    );
    return {
      userId: instance.userId,
      outcome: "skipped_not_pollable",
      status: result.status,
    };
  }

  const messages = result.data.messages;
  if (messages.length === 0) {
    await markPolled({ userId: instance.userId, resetErrors: true }).catch(
      () => undefined,
    );
    return { userId: instance.userId, outcome: "no_messages" };
  }

  try {
    await persistInboxMessages(instance.userId, messages);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_persist" },
      extra: { userId: instance.userId, count: messages.length },
    });
    await markPolled({ userId: instance.userId, incrementErrors: true }).catch(
      () => undefined,
    );
    return { userId: instance.userId, outcome: "error" };
  }

  try {
    await ackInstanceInbox(
      instance.userId,
      messages.map((message) => message.id),
      { signal: options.abortSignal },
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_ack" },
      extra: { userId: instance.userId, count: messages.length },
    });
    await markPolled({ userId: instance.userId, incrementErrors: true }).catch(
      () => undefined,
    );
    return {
      userId: instance.userId,
      outcome: "messages",
      count: messages.length,
    };
  }

  const latestCreatedAt = maxInboxMessageCreatedAt(messages);
  await markPolled({
    userId: instance.userId,
    lastInboxMessageAt: latestCreatedAt,
    resetErrors: true,
  }).catch(() => undefined);

  return {
    userId: instance.userId,
    outcome: "messages",
    count: messages.length,
  };
}

export async function syncHermesInboxForUser(
  userId: string,
  options: { signal?: AbortSignal } = {},
): Promise<PollOutcome> {
  const instance = await prisma.orchestrator.findFirst({
    where: { userId, archivedAt: null },
  });
  if (!instance) return { userId, outcome: "skipped_instance_missing" };

  return await pollOne(instance, {
    abortSignal: options.signal ?? new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
    shouldContinue: () => true,
  });
}

async function pollInboxes(
  options: SyncOptions,
): Promise<HermesInboxSyncSummary> {
  const breakdown = createEmptyBreakdown();

  if (!getEnv().HERMES_INBOX_POLLING_ENABLED) {
    return {
      status: "disabled",
      polled: 0,
      totalMessages: 0,
      breakdown,
    };
  }

  let due: Orchestrator[];
  try {
    due = await findDueForPoll(Date.now());
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_query" },
    });
    breakdown.error += 1;
    return {
      status: "ok",
      polled: 0,
      totalMessages: 0,
      breakdown,
    };
  }

  if (!shouldContinueSync(options)) {
    return {
      status: "ok",
      polled: 0,
      totalMessages: 0,
      breakdown,
    };
  }

  let totalMessages = 0;
  let polled = 0;
  let firstTransientError: unknown = null;
  let transientErrorCount = 0;

  for (const instance of due) {
    if (!shouldContinueSync(options)) {
      break;
    }

    try {
      const outcome = await pollOne(instance, options);
      polled += 1;
      breakdown[outcome.outcome] += 1;
      if (outcome.outcome === "messages") {
        totalMessages += outcome.count ?? 0;
      }
      if (outcome.transientError !== undefined) {
        transientErrorCount++;
        if (!firstTransientError) firstTransientError = outcome.transientError;
      }
    } catch (error) {
      polled += 1;
      breakdown.error += 1;
      Sentry.captureException(error, {
        tags: { context: "hermes_inbox_unhandled" },
        extra: { userId: instance.userId },
      });
    }
  }

  // Escalate to Sentry only when transient orchestrator failures dominate a
  // non-trivial batch — the signature of an actual orchestrator outage rather
  // than the occasional self-healing 502. Reporting every batch that had a
  // single failed poll kept SOKOSUMI-CORE-1M perpetually "regressed" (the cron
  // runs each minute and one 502 among healthy polls recovers next cycle).
  //
  // Use captureMessage with a dedicated fingerprint so this forms its own
  // outage issue instead of re-grouping under the raw HermesOrchestratorError —
  // re-capturing that exception would revive the per-request 502 issue we are
  // deliberately muting. The representative error rides along in `extra`.
  const isLikelyOutage =
    polled >= OUTAGE_MIN_POLLED_FOR_ALERT &&
    transientErrorCount >= Math.ceil(polled * OUTAGE_TRANSIENT_RATIO);

  if (isLikelyOutage) {
    Sentry.captureMessage("hermes_inbox_orchestrator_outage", {
      level: "error",
      fingerprint: ["hermes-inbox-orchestrator-outage"],
      tags: { context: "hermes_inbox_poll_batch" },
      extra: {
        transientErrorCount,
        polled,
        sampleError:
          firstTransientError instanceof Error
            ? firstTransientError.message
            : String(firstTransientError),
      },
    });
  }

  return {
    status: "ok",
    polled,
    totalMessages,
    breakdown,
  };
}

export const hermesInboxSyncService = {
  pollInboxes,
};
