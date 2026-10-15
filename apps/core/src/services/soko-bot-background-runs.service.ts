import { createHash } from "node:crypto";
import {
  isSokoBotSandboxCapability,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import prisma from "@/lib/db/prisma";
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
function runMessage(title: string, brief: string): string {
  // The control plane gives a run six hours; aim to report well before.
  const reportBy = new Date(Date.now() + 5.5 * 60 * 60 * 1_000);
  return [
    `Background run: ${title}`,
    `Report by ${reportBy.toISOString()} at the latest.`,
    "You are working on your own, beside your chat with the owner. The brief below is everything you were given; nobody is waiting to answer questions, so decide and keep going. Work through the whole job in batches, keep your plan up to date with update_plan, and save results as you go (a Files table, Task or file) so nothing is lost if you run out of time. Your final report is posted in the chat: start it with DONE:, say what you did, link what you made, and name anything left undone. A reply without DONE: is treated as a progress note and you will be asked to continue.",
    "",
    brief,
  ].join("\n");
}

/** Starts a background run with this turn's tools; returns at once. */
export async function startBackgroundRun(
  authorized: AuthorizedSokoBotRuntime,
  input: { title: string; brief: string },
) {
  const parent = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: {
      source: true,
      parentTurnId: true,
      askedByUserId: true,
      chainDepth: true,
      destinationRoomId: true,
    },
  });
  if (parent.parentTurnId)
    throw new SokoBotRuntimeValidationError(
      "A background run cannot start another one; do the work in this run.",
    );
  // A run works with the owner's whole context and posts where it was asked;
  // started from a teammate's or another bot's message, that would carry the
  // owner's private context into their room.
  if (parent.askedByUserId || parent.chainDepth > 0)
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
    userId: authorized.turn.requestedByUserId,
    workspaceId: authorized.turn.workspaceId,
    clientTurnId: `background:${authorized.turn.id}:${key}`,
    message: runMessage(input.title, input.brief),
    source: parent.source === "ADMIN_RETRY" ? "CHAT" : parent.source,
    versionId: authorized.turn.versionId ?? undefined,
    presetRoute: {
      route: "DELEGATE_TASK",
      reason: `Background run: ${input.title}`,
      capabilities,
      sandbox: capabilities.some(isSokoBotSandboxCapability),
    },
    background: {
      parentTurnId: authorized.turn.id,
      title: input.title,
      destinationRoomId: parent.destinationRoomId,
    },
  });
  // Drain it now like a chat turn; the turns sync takes over once this
  // request's function ends.
  if (
    started.reconciliationLeaseToken &&
    (started.status === "STARTING" || started.status === "RUNNING")
  )
    waitUntil(
      sokoBotControlPlane
        .reconcileTurn(
          started.turnId,
          undefined,
          started.reconciliationLeaseToken,
        )
        .catch((error: unknown) => {
          console.warn("Soko Bot background run reconciliation stopped", {
            turnId: started.turnId,
            error: error instanceof Error ? error.message : "unknown",
          });
        }),
    );
  return {
    runId: started.turnId,
    title: input.title,
    status: started.status,
    note: "Started. It works beside this chat and posts its answer here when it finishes.",
  };
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
  await sokoBotControlPlane.cancelTurn(
    authorized.turn.requestedByUserId,
    run.id,
  );
  return { runId: run.id, stopped: true, previousStatus: run.status };
}
