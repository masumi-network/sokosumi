import * as Sentry from "@sentry/node";
import type { HermesInstance, Prisma } from "@sokosumi/database";

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

function markPolled(args: {
  userId: string;
  lastInboxMessageAt?: Date | null;
  resetErrors?: boolean;
  incrementErrors?: boolean;
}): Promise<void> {
  const data: Prisma.HermesInstanceUpdateInput = {
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

  return prisma.hermesInstance
    .update({
      where: { userId: args.userId },
      data,
    })
    .then(() => undefined);
}

async function findDueForPoll(nowMs: number): Promise<HermesInstance[]> {
  return await prisma.hermesInstance.findMany({
    where: {
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
      await tx.hermesMessage.create({
        data: {
          userId,
          role: "assistant",
          content: message.content,
          kind: message.kind ?? "text",
        },
      });
    }
  });
}

async function pollOne(
  instance: HermesInstance,
  options: SyncOptions,
): Promise<PollOutcome> {
  const sinceIso = instance.lastInboxMessageAt?.toISOString() ?? null;

  let result: Awaited<ReturnType<typeof getInstanceInbox>>;
  try {
    result = await getInstanceInbox(instance.userId, {
      sinceIso,
      limit: INBOX_FETCH_LIMIT,
      signal: options.abortSignal,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_poll" },
      extra: { userId: instance.userId },
    });
    await markPolled({ userId: instance.userId, incrementErrors: true }).catch(
      () => undefined,
    );
    return { userId: instance.userId, outcome: "error" };
  }

  if (result.kind === "not_implemented") {
    await markPolled({ userId: instance.userId, resetErrors: true }).catch(
      () => undefined,
    );
    return { userId: instance.userId, outcome: "skipped_not_implemented" };
  }

  if (result.kind === "instance_missing") {
    await prisma.hermesInstance
      .delete({ where: { userId: instance.userId } })
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

  let due: HermesInstance[];
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

  const settled = await Promise.allSettled(
    due.map((instance) => pollOne(instance, options)),
  );

  let totalMessages = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      breakdown[result.value.outcome] += 1;
      if (result.value.outcome === "messages") {
        totalMessages += result.value.count ?? 0;
      }
    } else {
      breakdown.error += 1;
      if (result.reason instanceof HermesOrchestratorError) {
        Sentry.captureException(result.reason, {
          tags: { context: "hermes_inbox_unhandled" },
        });
      }
    }
  }

  return {
    status: "ok",
    polled: due.length,
    totalMessages,
    breakdown,
  };
}

export const hermesInboxSyncService = {
  pollInboxes,
};
