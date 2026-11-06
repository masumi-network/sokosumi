import type {
  Prisma,
  SeoAuditChatTurn as StoredTurn,
} from "@sokosumi/database";
import { generateText } from "ai";

import { DAY_MS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  badRequest,
  conflict,
  serviceUnavailable,
  tooManyRequests,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import { findSeoAnalysisExecutor } from "@/lib/seo/analysis-dispatch";
import {
  availableSeoChatActions,
  parseSeoChatReply,
  SEO_CHAT_SYSTEM,
  seoChatContext,
} from "@/lib/seo/chat-context";
import { seoSharingFor, seoVisibilityFor } from "@/lib/seo/data-visibility";
import { gatewayCostUsd } from "@/lib/soko-bot/gateway-cost";
import { sokoBotModelRequest } from "@/lib/soko-bot/model-policy";
import type { SeoActor } from "@/schemas/project-seo.schema";
import {
  SEO_CHAT_HISTORY_LIMIT,
  type SendSeoChat,
  type SeoChatTurn,
  sendSeoChatSchema,
  seoChatActionSchema,
  seoChatScopeSchema,
} from "@/schemas/seo-chat.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import {
  requireLockedSeoOwner,
  requireSeoOwner,
  sha256,
} from "@/services/project-seo-store";

export const SEO_CHAT_MODEL = "google/gemini-3.8-flash";
const SEO_CHAT_TIMEOUT_MS = 25_000;
const SEO_CHAT_LEASE_MS = 60_000;
const SEO_CHAT_MAX_OUTPUT_TOKENS = 3_000;
const SEO_CHAT_HISTORY_MAX_CHARS = 16_000;
const SEO_CHAT_AUTHOR_INCLUDE = {
  user: { select: { id: true, name: true } },
} as const;
type TurnWithAuthor = StoredTurn & {
  user: { id: string; name: string | null };
};

function conversationWhere(actor: SeoActor, auditId: string) {
  return {
    auditId,
    visibility: seoVisibilityFor(actor),
    ...(actor.organizationId ? {} : { userId: actor.userId }),
  };
}

export interface SeoChatDeps {
  generate: (
    system: string,
    prompt: string,
  ) => Promise<{ text: string; costUsd: number }>;
}

const defaultDeps: SeoChatDeps = {
  async generate(system, prompt) {
    if (!getEnv().AI_GATEWAY_API_KEY)
      throw serviceUnavailable("SEO chat is unavailable");
    const result = await generateText({
      ...sokoBotModelRequest({ role: "agent", model: SEO_CHAT_MODEL }),
      system,
      prompt,
      maxOutputTokens: SEO_CHAT_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(SEO_CHAT_TIMEOUT_MS),
    });
    return {
      text: result.text,
      costUsd: gatewayCostUsd(result.providerMetadata),
    };
  },
};

function auditIdFor(actor: SeoActor): string {
  if (actor.owner.kind !== "audit")
    throw badRequest("Choose an SEO audit for this conversation");
  return actor.owner.id;
}

function turnView(
  row: TurnWithAuthor,
  canRequestAnalysis: boolean,
): SeoChatTurn {
  const actions = seoChatActionSchema.array().safeParse(row.actions);
  return {
    id: row.id,
    author: { id: row.user.id, name: row.user.name },
    question: row.question,
    response: row.response,
    actions: actions.success
      ? availableSeoChatActions(actions.data, canRequestAnalysis)
      : [],
    status:
      row.status === "completed"
        ? "completed"
        : row.status === "running" && row.leaseExpiresAt > new Date()
          ? "running"
          : "failed",
    scope: seoChatScopeSchema.parse(row.scopeSnapshot),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSeoChat(actor: SeoActor) {
  const auditId = auditIdFor(actor);
  await requireSeoOwner(actor);
  const turns = await prisma.seoAuditChatTurn.findMany({
    where: conversationWhere(actor, auditId),
    include: SEO_CHAT_AUTHOR_INCLUDE,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: SEO_CHAT_HISTORY_LIMIT,
  });
  const executor = await findSeoAnalysisExecutor(actor);
  // Membership may have changed during the read. Never return a stale private projection.
  const currentOwner = await requireSeoOwner(actor);
  return {
    sharing: seoSharingFor(actor),
    turns: turns
      .reverse()
      .map((row) =>
        turnView(
          row,
          executor !== null &&
            !currentOwner.closingAt &&
            !currentOwner.closedAt,
        ),
      ),
  };
}

function historyPrompt(turns: StoredTurn[]) {
  let remaining = SEO_CHAT_HISTORY_MAX_CHARS;
  const history: Array<{ question: string; reply: string }> = [];
  for (const turn of turns) {
    if (!turn.response || remaining <= 0) continue;
    const question = turn.question.slice(0, remaining);
    remaining -= question.length;
    const reply = turn.response.slice(0, remaining);
    remaining -= reply.length;
    history.unshift({ question, reply });
  }
  return history;
}

/** A model can explain or propose UI actions. It never receives an execution capability. */
export async function sendSeoChat(
  actor: SeoActor,
  raw: SendSeoChat,
  deps: SeoChatDeps = defaultDeps,
) {
  const input = sendSeoChatSchema.parse(raw);
  const auditId = auditIdFor(actor);
  await requireSeoOwner(actor);
  const requestHash = sha256(JSON.stringify(input));
  const workspace = await getProjectSeoWorkspace(actor, input.scope ?? {});
  const scopeSnapshot = {
    name: workspace.scope.name,
    pageIds: workspace.scope.pageIds,
    scopeId: workspace.scope.id,
    version: workspace.scope.version,
    from: workspace.scope.from,
    to: workspace.scope.to,
  } satisfies Prisma.InputJsonObject;
  const reservation = await serializableTransaction(async (tx) => {
    await requireLockedSeoOwner(tx, actor);
    const previous = await tx.seoAuditChatTurn.findUnique({
      include: SEO_CHAT_AUTHOR_INCLUDE,
      where: {
        auditId_userId_idempotencyKey: {
          auditId,
          userId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (previous) {
      if (
        previous.requestHash !== requestHash ||
        previous.visibility !== seoVisibilityFor(actor)
      )
        throw conflict(
          "This chat request key was already used for another message",
        );
      return { row: previous, fresh: false };
    }
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const used = await tx.seoAuditChatTurn.count({
      where: {
        userId: actor.userId,
        audit: { workspaceId: actor.workspaceId },
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    if (used >= getEnv().SEO_CHAT_DAILY_TURN_LIMIT)
      throw tooManyRequests(
        "Your daily SEO chat allowance for this workspace is used. It resets at 00:00 UTC.",
        {
          retryAfterSeconds: Math.ceil(
            (dayEnd.getTime() - now.getTime()) / 1_000,
          ),
        },
      );
    await tx.seoAuditChatTurn.updateMany({
      where: {
        ...conversationWhere(actor, auditId),
        status: "running",
        leaseExpiresAt: { lte: now },
      },
      data: { status: "failed", completedAt: now },
    });
    const active = await tx.seoAuditChatTurn.findFirst({
      where: { ...conversationWhere(actor, auditId), status: "running" },
      select: { id: true },
    });
    if (active) throw conflict("An SEO chat reply is already in progress");
    const row = await tx.seoAuditChatTurn.create({
      data: {
        auditId,
        userId: actor.userId,
        visibility: seoVisibilityFor(actor),
        idempotencyKey: input.idempotencyKey,
        requestHash,
        question: input.question,
        scopeSnapshot,
        model: SEO_CHAT_MODEL,
        createdAt: now,
        leaseExpiresAt: new Date(now.getTime() + SEO_CHAT_LEASE_MS),
      },
      include: SEO_CHAT_AUTHOR_INCLUDE,
    });
    return { row, fresh: true };
  }, "The audit conversation changed. Try again.");
  if (!reservation.fresh)
    return turnView(
      reservation.row,
      workspace.availableActions.canRequestAnalysis,
    );

  let incurredCostUsd: number | undefined;
  try {
    const previous = await prisma.seoAuditChatTurn.findMany({
      where: {
        ...conversationWhere(actor, auditId),
        status: "completed",
        id: { not: reservation.row.id },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SEO_CHAT_HISTORY_LIMIT,
    });
    const result = await deps.generate(
      SEO_CHAT_SYSTEM,
      JSON.stringify({
        auditEvidence: seoChatContext(workspace),
        history: historyPrompt(previous),
        question: input.question,
      }),
    );
    if (!Number.isFinite(result.costUsd) || result.costUsd < 0)
      throw serviceUnavailable("SEO chat could not complete this reply");
    incurredCostUsd = result.costUsd;
    const reply = parseSeoChatReply(
      result.text,
      workspace.availableActions.canRequestAnalysis,
    );
    return await serializableTransaction(async (tx) => {
      await requireLockedSeoOwner(tx, actor);
      const saved = await tx.seoAuditChatTurn.updateMany({
        where: {
          id: reservation.row.id,
          userId: actor.userId,
          auditId,
          status: "running",
          leaseExpiresAt: { gt: new Date() },
        },
        data: {
          status: "completed",
          response: reply.reply,
          actions: reply.actions,
          costUsd: result.costUsd,
          completedAt: new Date(),
        },
      });
      if (saved.count !== 1)
        throw conflict("The SEO chat reply expired. Send a new message.");
      const row = await tx.seoAuditChatTurn.findUniqueOrThrow({
        where: { id: reservation.row.id },
        include: SEO_CHAT_AUTHOR_INCLUDE,
      });
      const executor = await findSeoAnalysisExecutor(actor, tx);
      return turnView(
        row,
        workspace.availableActions.canRequestAnalysis && executor !== null,
      );
    }, "The audit conversation changed. Try again.");
  } catch (error) {
    try {
      await prisma.seoAuditChatTurn.updateMany({
        where: {
          id: reservation.row.id,
          userId: actor.userId,
          auditId,
          status: { in: ["running", "failed"] },
        },
        data: {
          status: "failed",
          completedAt: new Date(),
          ...(incurredCostUsd === undefined
            ? {}
            : { costUsd: incurredCostUsd }),
        },
      });
    } catch (cleanupError) {
      // Preserve the original provider, validation or authorization failure.
      captureExternalServiceError(cleanupError, {
        label: "seo_chat_failure_record",
      });
    }
    throw error;
  }
}
