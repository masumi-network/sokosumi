import { type Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { type SokoBotCapability } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import {
  sokoBotTurnAudience,
  sokoBotTurnReaderOf,
} from "@/helpers/soko-bot-owner";
import { sokoBotForTurnMember } from "@/helpers/soko-bot-turn-authority";
import { sokoBotSharedScopeOf } from "@/helpers/task-visibility";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
  turnProvenance,
} from "@/lib/soko-bot/detached-network";
import { isStoredMeetingPrep } from "@/lib/soko-bot/system-routes";
import {
  type SokoBotWriteTargets,
  sokoBotWriteScopeRefusal,
} from "@/lib/soko-bot/write-scope";
import { getSokoBotAvailability } from "@/services/soko-bot-availability.service";
import {
  type AuthorizedSokoBotRuntime,
  type RuntimeAuthorizationInput,
  type SokoBotActionContext,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
  sokoBotToolCallLimit,
} from "../soko-bot-runtime.service";
import { requireSokoBotWorkspaceAccess } from "./acting-scope";
import { buildTurnGrant } from "./grant";
import { type RuntimeOperations } from "./operations";
import { ACTIVE_STATUSES } from "./task-policy";

export async function authorize(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
): Promise<AuthorizedSokoBotRuntime> {
  const env = getEnv();
  if (!env.SOKO_BOT_ENABLED) {
    throw new SokoBotRuntimeAuthorizationError("Soko Bot is not enabled");
  }
  // Re-checked on every tool call, so a turn already running when an
  // administrator threw the switch stops at its next action instead of
  // finishing its work.
  if ((await getSokoBotAvailability()).disabled) {
    throw new SokoBotRuntimeAuthorizationError(
      "Soko Bot is temporarily disabled by an administrator",
    );
  }
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: input.turnId },
    select: {
      id: true,
      network: true,
      preprodGeneration: true,
      clientTurnId: true,
      sokoBotId: true,
      requestedByUserId: true,
      askedByUserId: true,
      parentTurnId: true,
      workspaceId: true,
      eveSessionId: true,
      status: true,
      classification: true,
      classifierVersion: true,
      userMessage: true,
      versionId: true,
      modelId: true,
      source: true,
      chainDepth: true,
      intentId: true,
      intentRevision: true,
      createdAt: true,
      deadlineAt: true,
      leaseExpiresAt: true,
      capabilityNames: true,
      contextSnapshot: { select: { id: true, packet: true } },
      sokoBot: {
        select: {
          userId: true,
          adminPausedAt: true,
          archivedAt: true,
          status: true,
          workspaceId: true,
          projectId: true,
        },
      },
    },
  });
  if (!turn || turn.sokoBot.archivedAt) {
    throw new SokoBotRuntimeAuthorizationError("Soko Bot turn is unavailable");
  }
  if (
    !ACTIVE_STATUSES.includes(turn.status as (typeof ACTIVE_STATUSES)[number])
  ) {
    throw new SokoBotRuntimeAuthorizationError("Soko Bot turn is not active");
  }
  if (turn.status === "CANCEL_REQUESTED") {
    throw new SokoBotRuntimeAuthorizationError(
      "Soko Bot turn cancellation is pending",
    );
  }
  if (turn.sokoBot.status === "PAUSED" || turn.sokoBot.adminPausedAt) {
    throw new SokoBotRuntimeAuthorizationError("Soko Bot is paused");
  }
  if (
    turn.network === "preprod" &&
    turn.eveSessionId !== null &&
    turn.eveSessionId !== input.sessionId
  ) {
    throw new SokoBotRuntimeAuthorizationError("Runtime session mismatch");
  }
  const scope = await detachedNetworkScope(turn).catch(
    async (error: unknown) => {
      if (error instanceof DetachedNetworkRefusal && error.final) {
        const { sokoBotControlPlane } = await import(
          "../soko-bot-control-plane.service"
        );
        await sokoBotControlPlane.finishStaleTurn(turn.id);
      }
      throw error;
    },
  );
  const now = await databaseNow();
  if (
    turn.deadlineAt <= now ||
    !turn.leaseExpiresAt ||
    turn.leaseExpiresAt <= now
  ) {
    throw new SokoBotRuntimeAuthorizationError("Soko Bot turn lease expired");
  }
  if (turn.source === "SCHEDULE" || turn.source === "ADMIN_RETRY") {
    const { meetingReplayRefusal } = await import(
      "../soko-bot-admin-retry.service"
    );
    const refusal = await meetingReplayRefusal(turn);
    if (refusal) throw new SokoBotRuntimeAuthorizationError(refusal);
  }
  const actingUserId = sokoBotActingUserId(turn);
  const meetingPrep = isStoredMeetingPrep(turn);
  // An in-flight turn from before meeting prep lost its read tools can still have a stale grant.
  const grant = buildTurnGrant(
    meetingPrep ? { ...turn, capabilityNames: [] } : turn,
    input.sessionId,
  );
  if (input.capability && !grant.capabilities.includes(input.capability)) {
    throw new SokoBotRuntimeAuthorizationError(
      "Capability is not granted for this turn",
    );
  }
  let storedSessionId = turn.eveSessionId;
  if (storedSessionId === null) {
    storedSessionId = await serializableTransaction(async (tx) => {
      // Same bot-row-first order as administrator PAUSE. Session attachment
      // either commits before PAUSE or reloads its paused state and fails.
      await tx.$queryRaw`
          SELECT "id"
          FROM ${sharedTable("soko_bot")}
          WHERE "id" = ${turn.sokoBotId}::uuid
          FOR UPDATE
        `;
      await tx.$queryRaw`
          SELECT "id"
          FROM ${sharedTable("soko_bot_turn")}
          WHERE "id" = ${turn.id}::uuid
          FOR UPDATE
        `;
      const attachedAt = await databaseNow(tx);
      const attachable = await tx.sokoBotTurn.findFirst({
        where: {
          id: turn.id,
          sokoBotId: turn.sokoBotId,
          requestedByUserId: turn.requestedByUserId,
          workspaceId: turn.workspaceId,
          OR: [{ eveSessionId: null }, { eveSessionId: input.sessionId }],
          status: { in: ["STARTING", "RUNNING"] },
          deadlineAt: { gt: attachedAt },
          leaseExpiresAt: { gt: attachedAt },
          sokoBot: {
            adminPausedAt: null,
            archivedAt: null,
            status: { not: "PAUSED" },
          },
        },
        select: { eveSessionId: true, id: true, source: true },
      });
      if (!attachable) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot turn is no longer eligible for session attachment",
        );
      }
      if (
        attachable.eveSessionId !== null &&
        attachable.eveSessionId !== input.sessionId
      ) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot turn session attachment became stale",
        );
      }
      await requireSokoBotWorkspaceAccess(tx, actingUserId, turn.workspaceId);
      if (attachable.eveSessionId === null) {
        const boundTurn = await tx.sokoBotTurn.updateMany({
          where: {
            id: turn.id,
            eveSessionId: null,
            status: { in: ["STARTING", "RUNNING"] },
            deadlineAt: { gt: attachedAt },
            leaseExpiresAt: { gt: attachedAt },
            sokoBot: {
              adminPausedAt: null,
              archivedAt: null,
              status: { not: "PAUSED" },
            },
          },
          data: { eveSessionId: input.sessionId },
        });
        if (boundTurn.count !== 1) {
          throw new SokoBotRuntimeAuthorizationError(
            "Soko Bot turn session attachment became stale",
          );
        }
      }
      const runnable = await sokoBotForTurnMember(
        {
          sokoBotId: turn.sokoBotId,
          workspaceId: turn.workspaceId,
          actingUserId,
        },
        "runningNotAdminPaused",
        tx,
      );
      // The bot retains the prior completed turn's session for diagnostics.
      // Bot + turn locks and the attachable active-turn check above provide
      // the single-flight fence, so the new turn safely replaces that id.
      const boundBot = runnable
        ? await tx.sokoBot.updateMany({
            where: { id: runnable.id },
            data: { eveSessionId: input.sessionId },
          })
        : null;
      if (boundBot?.count !== 1) {
        throw new SokoBotRuntimeAuthorizationError(
          "Soko Bot runtime session attachment became stale",
        );
      }
      return input.sessionId;
    }, "Soko Bot session attachment collided with administrator control");
  } else {
    await requireSokoBotWorkspaceAccess(prisma, actingUserId, turn.workspaceId);
  }
  if (storedSessionId !== input.sessionId) {
    throw new SokoBotRuntimeAuthorizationError("Runtime session mismatch");
  }

  return {
    scope,
    provenance: turnProvenance(turn),
    grant,
    ...(meetingPrep ? { meetingPrep: true as const } : {}),
    toolCallLimit: sokoBotToolCallLimit(turn),
    askedByKind: sokoBotTurnAudience(turn),
    reader: sokoBotTurnReaderOf(turn),
    turn: {
      id: turn.id,
      sokoBotId: turn.sokoBotId,
      actingUserId,
      requestedByUserId: turn.requestedByUserId,
      askedByUserId: turn.askedByUserId ?? null,
      parentTurnId: turn.parentTurnId ?? null,
      botProjectId: turn.sokoBot.projectId ?? null,
      workspaceId: turn.workspaceId,
      eveSessionId: storedSessionId,
      versionId: turn.versionId,
      modelId: turn.modelId,
      source: turn.source,
      clientTurnId: turn.clientTurnId,
      chainDepth: turn.chainDepth,
      intentId: turn.intentId,
      intentRevision: turn.intentRevision,
    },
    classificationConfidence:
      typeof turn.classification === "object" &&
      turn.classification !== null &&
      "confidence" in turn.classification &&
      typeof turn.classification.confidence === "number"
        ? turn.classification.confidence
        : 1,
    ...complexityOf(turn.classification),
  };
}

function complexityOf(classification: unknown): { complexity?: string } {
  const label =
    typeof classification === "object" &&
    classification !== null &&
    "complexity" in classification &&
    typeof classification.complexity === "object" &&
    classification.complexity !== null &&
    "label" in classification.complexity
      ? classification.complexity.label
      : undefined;
  return typeof label === "string" ? { complexity: label } : {};
}

export async function requireMutationAuthority(
  runtime: Pick<RuntimeOperations, "requireWriteScope">,
  tx: Prisma.TransactionClient,
  authorized: SokoBotActionContext,
  approved: boolean,
  capability?: SokoBotCapability,
  targets: SokoBotWriteTargets = {},
) {
  if (approved && authorized.confirmationTurnId) {
    await tx.$queryRaw`SELECT "id" FROM ${sharedTable("soko_bot_turn")} WHERE "id" = ${authorized.confirmationTurnId}::uuid FOR UPDATE`;
  }
  if (approved) {
    // Serialize approved decisions with administrator PAUSE. Whichever
    // transaction locks the bot first defines whether this mutation lands
    // before the pause or is rejected after it.
    await tx.$queryRaw`
        SELECT "id"
        FROM ${sharedTable("soko_bot")}
        WHERE "id" = ${authorized.turn.sokoBotId}::uuid
        FOR UPDATE
      `;
  } else {
    // Serialize runtime writes with cancellation. A plain status read allows
    // Task/memory writes to commit after cancelTurn changes this row.
    await tx.$queryRaw`
        SELECT "id"
        FROM ${sharedTable("soko_bot_turn")}
        WHERE "id" = ${authorized.turn.id}::uuid
        FOR UPDATE
      `;
    // Serialize runtime effects with pause as well as turn cancellation.
    await tx.$queryRaw`SELECT "id" FROM ${sharedTable("soko_bot")} WHERE "id" = ${authorized.turn.sokoBotId}::uuid FOR UPDATE`;
  }
  const intentTurn = await tx.sokoBotTurn.findFirst({
    where: { id: authorized.turn.id },
    select: { intentId: true, intentRevision: true },
  });
  if (intentTurn?.intentId) {
    await tx.$queryRaw`SELECT "id" FROM ${sharedTable("soko_bot_intent")} WHERE "id" = ${intentTurn.intentId}::uuid FOR UPDATE`;
  }
  // Sample after the last lock so intent and lease expirations during the wait both count.
  const now = await databaseNow(tx);
  if (intentTurn?.intentId) {
    const intent = await tx.sokoBotIntent.findFirst({
      where: {
        id: intentTurn.intentId,
        ...(intentTurn.intentRevision != null
          ? { revision: intentTurn.intentRevision }
          : {}),
        sokoBotId: authorized.turn.sokoBotId,
        workspaceId: authorized.turn.workspaceId,
        state: { notIn: ["CANCELLED", "SUPERSEDED", "EXPIRED"] },
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (!intent)
      throw new SokoBotRuntimeAuthorizationError(
        "Intent is expired, cancelled or superseded",
      );
  }
  if (approved && authorized.confirmationTurnId) {
    const confirmation = await tx.sokoBotTurn.findFirst({
      where: {
        id: authorized.confirmationTurnId,
        sokoBotId: authorized.turn.sokoBotId,
        requestedByUserId: authorized.turn.requestedByUserId,
        workspaceId: authorized.turn.workspaceId,
        source: "CHAT",
        chainDepth: 0,
        status: { in: ["STARTING", "RUNNING"] },
        deadlineAt: { gt: now },
        leaseExpiresAt: { gt: now },
        cancellationRequestedAt: null,
      },
      select: { id: true },
    });
    if (!confirmation)
      throw new SokoBotRuntimeAuthorizationError(
        "Confirmation turn is no longer writable",
      );
  }
  const workspace = await requireSokoBotWorkspaceAccess(
    tx,
    authorized.turn.actingUserId,
    authorized.turn.workspaceId,
  );
  if (approved) {
    const activeBot = await sokoBotForTurnMember(
      authorized.turn,
      "runningNotAdminPaused",
      tx,
    );
    if (!activeBot) {
      throw new SokoBotRuntimeAuthorizationError(
        "Soko Bot is paused or unavailable",
      );
    }
    await runtime.requireWriteScope(tx, authorized.scope, activeBot, targets);
    return workspace;
  }

  const writable = await tx.sokoBotTurn.findFirst({
    where: {
      id: authorized.turn.id,
      sokoBotId: authorized.turn.sokoBotId,
      requestedByUserId: authorized.turn.requestedByUserId,
      workspaceId: authorized.turn.workspaceId,
      status: { in: ["STARTING", "RUNNING"] },
      deadlineAt: { gt: now },
      leaseExpiresAt: { gt: now },
      cancellationRequestedAt: null,
      ...(capability ? { capabilityNames: { has: capability } } : {}),
      sokoBot: {
        archivedAt: null,
        adminPausedAt: null,
        status: { not: "PAUSED" },
      },
    },
    select: {
      id: true,
      sokoBot: {
        select: {
          id: true,
          userId: true,
          workspaceId: true,
          projectId: true,
        },
      },
    },
  });
  if (!writable) {
    throw new SokoBotRuntimeAuthorizationError(
      "Soko Bot turn is no longer writable",
    );
  }
  await runtime.requireWriteScope(
    tx,
    authorized.scope,
    writable.sokoBot,
    targets,
  );
  return workspace;
}

/** A shared bot writes only inside its scope; a personal bot is unchanged. */
export async function requireWriteScope(
  runtime: RuntimeOperations,
  tx: Prisma.TransactionClient,
  scope: AuthorizedSokoBotRuntime["scope"],
  bot: Parameters<typeof sokoBotSharedScopeOf>[0] | undefined,
  targets: SokoBotWriteTargets,
) {
  const refusal = await sokoBotWriteScopeRefusal(
    tx,
    scope,
    bot ? sokoBotSharedScopeOf(bot) : null,
    targets,
  );
  if (refusal) throw new SokoBotRuntimeValidationError(refusal);
}
