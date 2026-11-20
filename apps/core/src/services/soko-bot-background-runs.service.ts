import { createHash } from "node:crypto";
import {
  isSokoBotSandboxCapability,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { HTTPException } from "hono/http-exception";
import prisma from "@/lib/db/prisma";
import {
  createCoreLogger,
  logCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

/** A run does the work itself; it does not hand it on again. */
const RUN_MANAGEMENT_TOOLS = new Set<SokoBotCapability>([
  "start_background_run",
  "stop_background_run",
]);

const LISTED_RUNS = 10;
const ANSWER_PREVIEW_CHARS = 1_500;

/**
 * The run reads this first. It has no conversation to fall back on, so it is
 * told plainly that the brief is all it gets and where its answer goes.
 */
function runMessage(title: string, brief: string, shared: boolean): string {
  // The control plane gives a run six hours; aim to report well before.
  const reportBy = new Date(Date.now() + 5.5 * 60 * 60 * 1_000);
  return [
    `Background run: ${title}`,
    `Report by ${reportBy.toISOString()} at the latest.`,
    `You are working on your own, beside ${shared ? "the chat you were asked in" : "your chat with the owner"}. The brief below is everything you were given; nobody is waiting to answer questions, so decide and keep going. Work through the whole job in batches, keep your plan up to date with update_plan, and save results as you go (a Files table, Task or file) so nothing is lost if you run out of time. Your final report is posted in the chat: start it with DONE:, say what you did, link what you made, and name anything left undone. A reply without DONE: is treated as a progress note and you will be asked to continue.`,
    "",
    brief,
  ].join("\n");
}

/** Starts a background run with this turn's tools; returns at once. */
export async function startBackgroundRun(
  authorized: AuthorizedSokoBotRuntime,
  input: { title: string; brief: string },
) {
  const shared = Boolean(authorized.reader.sharedScope);
  const parent = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: {
      source: true,
      parentTurnId: true,
      requestedByUserId: true,
      askedByUserId: true,
      chainDepth: true,
      destinationRoomId: true,
      sokoBot: { select: { sharedRoomId: true } },
    },
  });
  if (parent.parentTurnId)
    throw new SokoBotRuntimeValidationError(
      "A background run cannot start another one; do the work in this run.",
    );
  const member = authorized.turn.actingUserId;
  if (shared) {
    // A shared bot has no owner (ADR 0057): the run is the member's who asked
    // for it in chat. Its own rhythms, another bot's message and a follow-up
    // start none, so a run always has a person who can stop it.
    if (
      member === null ||
      parent.source !== "CHAT" ||
      parent.chainDepth > 0 ||
      parent.askedByUserId !== parent.requestedByUserId ||
      authorized.askedByKind === "ASSISTANT"
    )
      throw new SokoBotRuntimeValidationError(
        "Only a member's own request in chat can start a background run; do the work in this turn.",
      );
    const running = await activeMemberRun(authorized.turn.sokoBotId);
    if (running)
      throw new SokoBotRuntimeValidationError(
        `"${running.backgroundTitle}" is still running (runId ${running.id}). One background run at a time: wait for it, or stop it with stop_background_run first.`,
      );
  } else if (parent.askedByUserId || parent.chainDepth > 0)
    // A run works with the owner's whole context and posts where it was
    // asked; started from a teammate's or another bot's message, that would
    // carry the owner's private context into their room.
    throw new SokoBotRuntimeValidationError(
      "Only the owner can start a background run.",
    );
  const capabilities = authorized.grant.capabilities.filter(
    (capability) => !RUN_MANAGEMENT_TOOLS.has(capability),
  );
  const key = createHash("sha256")
    .update(`${input.title}\n${input.brief}`)
    .digest("hex")
    .slice(0, 16);
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  const started = await sokoBotControlPlane.startTurn({
    userId: authorized.turn.actingUserId,
    workspaceId: authorized.turn.workspaceId,
    // Cuso shares a workspace with the owner's own assistant: the run belongs
    // to the bot that started it.
    sokoBotId: authorized.turn.sokoBotId,
    clientTurnId: `${MEMBER_RUN_PREFIX}${authorized.turn.id}:${key}`,
    message: runMessage(input.title, input.brief, shared),
    source: parent.source === "ADMIN_RETRY" ? "CHAT" : parent.source,
    versionId: authorized.turn.versionId ?? undefined,
    presetRoute: {
      route: "DELEGATE_TASK",
      reason: `Background run: ${input.title}`,
      capabilities,
      sandbox: capabilities.some(isSokoBotSandboxCapability),
    },
    // The member asks the run as they asked the turn: it keeps their audience.
    ...(shared && member ? { chat: { askedByUserId: member } } : {}),
    background: {
      parentTurnId: authorized.turn.id,
      title: input.title,
      // A shared bot reports in its own room, where every member reads it.
      destinationRoomId:
        (shared ? parent.sokoBot.sharedRoomId : null) ??
        parent.destinationRoomId,
    },
  });
  // Drain it now like a chat turn; the turns sync takes over once this
  // request's function ends.
  const { reconciliationLeaseToken } = started;
  if (
    reconciliationLeaseToken &&
    (started.status === "STARTING" || started.status === "RUNNING")
  )
    waitUntil(
      runAsBackgroundWork(() =>
        sokoBotControlPlane
          .reconcileTurn(started.turnId, undefined, reconciliationLeaseToken)
          .catch((error: unknown) => {
            if (reportSokoBotReconciliationLeaseLoss(started.turnId, error))
              return;
            // After the tool call's response: its own event.
            const log = createCoreLogger({
              operation: "soko_bot_background_run",
              turn: { id: started.turnId, parentId: authorized.turn.id },
            });
            logCoreWarning(
              log,
              {
                message:
                  "A Soko Bot background run stopped draining before it finished",
                why: "Turn reconciliation threw",
                fix: "The soko-bot-turns sync resumes the run. If it stays stuck, read the turn's events.",
              },
              // Only safe fields: turn work can echo its prompt.
              { failure: messageSafeErrorFields(error) },
            );
            log.emit();
          }),
      ),
    );
  return {
    runId: started.turnId,
    title: input.title,
    status: started.status,
    note: "Started. It works beside this chat and posts its answer here when it finishes.",
  };
}

/** Runs a bot started with `start_background_run` carry this in their key. */
const MEMBER_RUN_PREFIX = "background:";

/** The run a member started that is still going, if there is one. */
function activeMemberRun(sokoBotId: string) {
  return prisma.sokoBotTurn.findFirst({
    where: {
      sokoBotId,
      parentTurnId: { not: null },
      clientTurnId: { startsWith: MEMBER_RUN_PREFIX },
      status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
    },
    select: { id: true, backgroundTitle: true },
  });
}

function latestPlan(input: unknown): unknown {
  return input && typeof input === "object" && "steps" in input
    ? (input as { steps: unknown }).steps
    : null;
}

/** The bot's background runs, newest first, with each one's latest plan. */
export async function listBackgroundRuns(authorized: AuthorizedSokoBotRuntime) {
  const runs = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: authorized.turn.sokoBotId,
      workspaceId: authorized.turn.workspaceId,
      parentTurnId: { not: null },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LISTED_RUNS,
    select: {
      id: true,
      backgroundTitle: true,
      status: true,
      createdAt: true,
      deadlineAt: true,
      completedAt: true,
      finalAnswer: true,
      errorKind: true,
      _count: { select: { toolCalls: true } },
      toolCalls: {
        where: { capability: "update_plan" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { input: true },
      },
    },
  });
  return {
    runs: runs.map((run) => ({
      runId: run.id,
      title: run.backgroundTitle,
      status: run.status,
      startedAt: run.createdAt.toISOString(),
      mustEndBy: run.deadlineAt.toISOString(),
      finishedAt: run.completedAt?.toISOString() ?? null,
      toolCalls: run._count.toolCalls,
      plan: latestPlan(run.toolCalls[0]?.input),
      answer: run.finalAnswer?.slice(0, ANSWER_PREVIEW_CHARS) ?? null,
      error: run.errorKind,
    })),
  };
}

/** Stops one of the bot's own background runs. */
export async function stopBackgroundRun(
  authorized: AuthorizedSokoBotRuntime,
  runId: string,
) {
  const run = await prisma.sokoBotTurn.findFirst({
    where: {
      id: runId,
      sokoBotId: authorized.turn.sokoBotId,
      parentTurnId: { not: null },
    },
    select: { id: true, status: true },
  });
  if (!run)
    throw new SokoBotRuntimeValidationError(
      "No background run with that runId; list_background_runs shows yours.",
    );
  const { sokoBotControlPlane } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  try {
    await sokoBotControlPlane.cancelTurn(
      authorized.turn.actingUserId ?? { sokoBotId: authorized.turn.sokoBotId },
      run.id,
    );
  } catch (error) {
    // A shared bot's run is stopped by the member who started it, or by an
    // owner or admin: say so, so the bot can tell whoever asked.
    if (error instanceof HTTPException && error.status === 403)
      throw new SokoBotRuntimeValidationError(error.message);
    throw error;
  }
  return { runId: run.id, stopped: true, previousStatus: run.status };
}
