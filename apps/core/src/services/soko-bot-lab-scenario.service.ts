import {
  SOKO_BOT_SYSTEM_SCHEDULES,
  type SokoBotScenario,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { DETACHED_SOKO_BOT_NETWORK } from "@/lib/network";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import {
  SYSTEM_TURN_ROUTES,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { buildIngestDeltaMessageForBot } from "@/services/soko-bot-ingest.service";
import { simulateSokoBotTaskEvent } from "@/services/soko-bot-lab.service";
import { buildSystemBeatMessage } from "@/services/soko-bot-proactive.service";

/**
 * Starting and reading a behaviour scenario's turn, shared by the headless
 * lab (`scripts/soko-bot-lab.mts`) and the eval runner. `clientTurnId` must
 * start with `lab:`: that keeps the turn out of the owner's allowance and
 * lets a later Coworker event find the Tasks earlier scenarios made.
 */
export interface LabScenarioOwner {
  bot: { id: string; userId: string };
  workspaceId: string;
}

/** An eval lane may supply the frozen packet for a built-in schedule. */
export interface LabScenario extends SokoBotScenario {
  preparedSchedule?: "meeting-prep";
}

export const SETTLED_TURN_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"];

async function reconciled(started: {
  turnId: string;
  reconciliationLeaseToken?: string | null;
}) {
  if (started.reconciliationLeaseToken) {
    await sokoBotControlPlane
      .reconcileTurn(
        started.turnId,
        undefined,
        started.reconciliationLeaseToken,
      )
      .catch((error) => {
        reportSokoBotReconciliationLeaseLoss(started.turnId, error);
      });
  }
  return started.turnId;
}

export async function startLabScenarioTurn(
  scenario: LabScenario,
  owner: LabScenarioOwner,
  clientTurnId: string,
): Promise<string> {
  if (!clientTurnId.startsWith("lab:"))
    throw new Error("A scenario turn's client id starts with lab:");
  if (scenario.trigger?.kind === "ingest") {
    const bot = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: owner.bot.id },
      select: {
        id: true,
        workspaceId: true,
        ingestTimezone: true,
        followWholeBoard: true,
      },
    });
    const beat = scenario.trigger.beat;
    const message =
      beat === "delta"
        ? await buildIngestDeltaMessageForBot(bot.id)
        : (
            await buildSystemBeatMessage({
              bot: {
                id: bot.id,
                userId: owner.bot.userId,
                workspaceId: bot.workspaceId,
                ingestTimezone: bot.ingestTimezone,
                followWholeBoard: bot.followWholeBoard,
              },
              key: beat,
              prompt:
                SOKO_BOT_SYSTEM_SCHEDULES.find((s) => s.key === beat)?.prompt ??
                "Daily stand-up.",
              now: new Date(),
            })
          ).message;
    return reconciled(
      await sokoBotControlPlane.startTurn({
        network: DETACHED_SOKO_BOT_NETWORK,
        userId: owner.bot.userId,
        workspaceId: owner.workspaceId,
        clientTurnId,
        message,
        source: beat === "delta" ? "INGEST" : "SCHEDULE",
        // The route the cron grants, not a classifier guess from Core's own prompt.
        presetRoute:
          beat === "delta"
            ? SYSTEM_TURN_ROUTES["ingest:delta"]
            : systemScheduleRoute(beat),
      }),
    );
  }
  if (scenario.trigger?.kind === "task_event") {
    // Only ever a Task a lab turn created: falling back to the bot's newest
    // delegation posted fake Coworker events onto the owner's real work.
    const labTask = await prisma.sokoBotDelegation.findFirst({
      where: {
        action: "create_task",
        turn: {
          sokoBotId: owner.bot.id,
          clientTurnId: { startsWith: "lab:" },
        },
        task: { archivedAt: null },
      },
      orderBy: { createdAt: "desc" },
      select: { taskId: true },
    });
    if (!labTask?.taskId)
      throw new Error("No lab-created Task to simulate Coworker activity on");
    const simulated = await simulateSokoBotTaskEvent({
      userId: owner.bot.userId,
      workspaceId: owner.workspaceId,
      taskId: labTask.taskId,
      status: scenario.trigger.status,
      comment: scenario.trigger.comment,
    });
    return simulated.turnId;
  }
  const key = scenario.preparedSchedule;
  const schedule =
    key && SOKO_BOT_SYSTEM_SCHEDULES.find((entry) => entry.key === key);
  if (key && !schedule) throw new Error(`Missing system schedule: ${key}`);
  return reconciled(
    await sokoBotControlPlane.startTurn({
      network: DETACHED_SOKO_BOT_NETWORK,
      userId: owner.bot.userId,
      workspaceId: owner.workspaceId,
      clientTurnId,
      message: schedule
        ? `${schedule.prompt}\n\n${scenario.prompt}`
        : scenario.prompt,
      ...(key
        ? {
            sokoBotId: owner.bot.id,
            source: "SCHEDULE",
            presetRoute: SYSTEM_TURN_ROUTES[key],
          }
        : {}),
    }),
  );
}

/** A finished turn as `evaluateScenario` reads it, with what it cost. */
export async function loadLabScenarioTurn(turnId: string) {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: {
      status: true,
      route: true,
      userMessage: true,
      finalAnswer: true,
      durationMs: true,
      costUsdMicros: true,
      errorKind: true,
      errorDetail: true,
      toolCalls: {
        orderBy: { createdAt: "asc" },
        select: {
          capability: true,
          status: true,
          input: true,
          result: true,
          errorKind: true,
        },
      },
      events: { select: { type: true, toolName: true } },
      delegations: {
        select: {
          id: true,
          taskId: true,
          jobId: true,
          action: true,
          outcome: true,
          followUp: true,
        },
      },
      pendingDecisions: { select: { id: true, resultingEntityId: true } },
      contextSnapshot: { select: { packet: true } },
    },
  });
  const { pendingDecisions, contextSnapshot, ...rest } = turn;
  return {
    ...rest,
    decisions: pendingDecisions,
    contextPacket: contextSnapshot?.packet ?? null,
    costUsd:
      turn.costUsdMicros === null ? null : Number(turn.costUsdMicros) / 1e6,
  };
}
