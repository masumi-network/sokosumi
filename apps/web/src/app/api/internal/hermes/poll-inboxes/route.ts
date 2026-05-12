import * as Sentry from "@sentry/nextjs";
import type { HermesInstance } from "@sokosumi/database";
import {
  hermesInstanceRepository,
  hermesMessageRepository,
} from "@sokosumi/database/repositories";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/prisma";
import {
  ackInstanceInbox,
  getInstanceInbox,
  type HermesInboxMessage,
  HermesOrchestratorError,
  HermesOrchestratorNotConfiguredError,
} from "@/lib/hermes/orchestrator-client";

/**
 * Hermes inbox poller. Pull-based: every Hermes instance accumulates outbound
 * messages on the orchestrator side; this cron drains them into Sokosumi's
 * `HermesMessage` table so they show up in the user's chat regardless of
 * whether they're actively connected.
 *
 * Triggered on a schedule (Vercel Cron or equivalent). Adaptive cadence —
 * recently-active instances get polled more often. Suspended instances are
 * skipped (the orchestrator returns 409 cheaply without waking the sprite).
 */

const HOT_LOOKBACK_MS = 10 * 60_000; // last message <10 min ago → hot
const WARM_LOOKBACK_MS = 60 * 60_000; // last message <60 min ago → warm
const HOT_POLL_INTERVAL_MS = 60_000; // poll hot every 1 min
const WARM_POLL_INTERVAL_MS = 2 * 60_000; // poll warm every 2 min
const COLD_POLL_INTERVAL_MS = 10 * 60_000; // poll cold every 10 min
const POLL_BATCH_LIMIT = 100; // max instances processed per cron tick
const INBOX_FETCH_LIMIT = 50;

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

function isAuthorized(req: NextRequest): boolean {
  const env = getEnvSecrets();
  const expected = env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

async function pollOne(inst: HermesInstance): Promise<PollOutcome> {
  const sinceIso = inst.lastInboxMessageAt?.toISOString() ?? null;

  let result: Awaited<ReturnType<typeof getInstanceInbox>>;
  try {
    result = await getInstanceInbox(inst.userId, {
      sinceIso,
      limit: INBOX_FETCH_LIMIT,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_poll" },
      extra: { userId: inst.userId },
    });
    await hermesInstanceRepository
      .markPolled({ userId: inst.userId, incrementErrors: true }, prisma)
      .catch(() => undefined);
    return { userId: inst.userId, outcome: "error" };
  }

  if (result.kind === "not_implemented") {
    await hermesInstanceRepository
      .markPolled({ userId: inst.userId, resetErrors: true }, prisma)
      .catch(() => undefined);
    return { userId: inst.userId, outcome: "skipped_not_implemented" };
  }
  if (result.kind === "instance_missing") {
    // Orchestrator no longer knows this instance — clean up the local row.
    await hermesInstanceRepository
      .deleteForUser(inst.userId, prisma)
      .catch(() => undefined);
    return { userId: inst.userId, outcome: "skipped_instance_missing" };
  }
  if (result.kind === "instance_not_pollable") {
    await hermesInstanceRepository
      .markPolled({ userId: inst.userId, resetErrors: true }, prisma)
      .catch(() => undefined);
    return {
      userId: inst.userId,
      outcome: "skipped_not_pollable",
      status: result.status,
    };
  }

  const messages: HermesInboxMessage[] = result.data.messages;
  if (messages.length === 0) {
    await hermesInstanceRepository
      .markPolled({ userId: inst.userId, resetErrors: true }, prisma)
      .catch(() => undefined);
    return { userId: inst.userId, outcome: "no_messages" };
  }

  // Persist as assistant turns. We persist before acking — if ack fails, the
  // next poll's `since` cursor will already exclude these (we just bumped it),
  // so duplicates are bounded to the rare ack-failure window. Worth revisiting
  // with an `orchestratorMessageId` unique column if dupes become observable.
  try {
    await prisma.$transaction(async (tx) => {
      for (const m of messages) {
        await hermesMessageRepository.append(
          {
            userId: inst.userId,
            role: "assistant",
            content: m.content,
            kind: m.kind ?? "text",
          },
          tx,
        );
      }
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_persist" },
      extra: { userId: inst.userId, count: messages.length },
    });
    await hermesInstanceRepository
      .markPolled({ userId: inst.userId, incrementErrors: true }, prisma)
      .catch(() => undefined);
    return { userId: inst.userId, outcome: "error" };
  }

  // Ack the messages so Hermes can drop them from its outbox. Failures here
  // are non-fatal — they'll just be re-served on the next poll, persisted
  // again (potential dupe), and Hermes will eventually drop them.
  try {
    await ackInstanceInbox(
      inst.userId,
      messages.map((m) => m.id),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_ack" },
      extra: { userId: inst.userId, count: messages.length },
    });
  }

  // Advance the cursor to the latest message's createdAt. The spec guarantees
  // ascending order so the last item is the newest.
  const latestCreatedAt = new Date(messages[messages.length - 1]!.createdAt);

  await hermesInstanceRepository
    .markPolled(
      {
        userId: inst.userId,
        lastInboxMessageAt: latestCreatedAt,
        resetErrors: true,
      },
      prisma,
    )
    .catch(() => undefined);

  return { userId: inst.userId, outcome: "messages", count: messages.length };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = getEnvSecrets();
  if (!env.HERMES_INBOX_POLLING_ENABLED) {
    return NextResponse.json({
      status: "disabled",
      hint: "Set HERMES_INBOX_POLLING_ENABLED=true to enable.",
    });
  }

  if (!env.HERMES_ORCH_BASE_URL || !env.HERMES_ORCH_TOKEN) {
    return NextResponse.json(
      { error: "orchestrator_not_configured" },
      { status: 503 },
    );
  }

  const now = Date.now();
  let due: HermesInstance[];
  try {
    due = await hermesInstanceRepository.findDueForPoll(
      {
        hotCutoff: new Date(now - HOT_LOOKBACK_MS),
        warmCutoff: new Date(now - WARM_LOOKBACK_MS),
        hotMaxLastPolledAt: new Date(now - HOT_POLL_INTERVAL_MS),
        warmMaxLastPolledAt: new Date(now - WARM_POLL_INTERVAL_MS),
        coldMaxLastPolledAt: new Date(now - COLD_POLL_INTERVAL_MS),
        limit: POLL_BATCH_LIMIT,
      },
      prisma,
    );
  } catch (error) {
    if (error instanceof HermesOrchestratorNotConfiguredError) {
      return NextResponse.json(
        { error: "orchestrator_not_configured" },
        { status: 503 },
      );
    }
    Sentry.captureException(error, {
      tags: { context: "hermes_inbox_query" },
    });
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 },
    );
  }

  // Process in parallel — each instance's work is independent. allSettled so
  // one bad instance can't poison the batch.
  const settled = await Promise.allSettled(due.map(pollOne));

  const tally: Record<string, number> = {
    messages: 0,
    no_messages: 0,
    skipped_not_implemented: 0,
    skipped_not_pollable: 0,
    skipped_instance_missing: 0,
    error: 0,
  };
  let totalMessages = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") {
      tally[r.value.outcome] = (tally[r.value.outcome] ?? 0) + 1;
      if (r.value.outcome === "messages") {
        totalMessages += r.value.count ?? 0;
      }
    } else {
      tally.error = (tally.error ?? 0) + 1;
      if (r.reason instanceof HermesOrchestratorError) {
        Sentry.captureException(r.reason, {
          tags: { context: "hermes_inbox_unhandled" },
        });
      }
    }
  }

  return NextResponse.json({
    status: "ok",
    polled: due.length,
    totalMessages,
    breakdown: tally,
  });
}
