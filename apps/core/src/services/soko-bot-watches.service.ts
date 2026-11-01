import {
  isSokoBotCapability,
  isSokoBotSandboxCapability,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import type { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

type WaitForInput = z.infer<(typeof SOKO_BOT_TOOL_INPUT_SCHEMAS)["wait_for"]>;
export type SokoBotWatchKind = WaitForInput["kind"];

const DEFAULT_TIMEOUT_MINUTES = 60;
/** Waits one bot may hold at once; more is a loop, not a plan. */
const MAX_WAITING_PER_BOT = 10;
const BATCH = 50;
const OUTCOME_CHARS = 1_500;
const PENDING_STUDIO = new Set([
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "SUBMISSION_UNCERTAIN",
]);
const ACTIVE_TURN = new Set([
  "QUEUED",
  "STARTING",
  "RUNNING",
  "CANCEL_REQUESTED",
]);
/** A follow-up does the next step itself; it does not start runs. */
const RUN_MANAGEMENT_TOOLS = new Set<SokoBotCapability>([
  "start_background_run",
  "stop_background_run",
]);

function clip(text: string, max = OUTCOME_CHARS): string {
  const flat = text.trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Where a wait stands: still waiting (null), or done with a line saying what
 * came of it. Reads only; never nudges a provider or starts anything.
 */
export async function watchOutcome(watch: {
  kind: string;
  targetId: string;
  projectId: string | null;
  sokoBotId: string;
  createdAt: Date;
}): Promise<string | null> {
  if (watch.kind === "studio_job") {
    const job = await prisma.projectImageJob.findUnique({
      where: { id: watch.targetId },
      select: { status: true, kind: true },
    });
    if (!job) return "The Studio job no longer exists.";
    if (PENDING_STUDIO.has(job.status)) return null;
    const video = job.kind === "TEXT_TO_VIDEO" || job.kind === "IMAGE_TO_VIDEO";
    const read = video ? "get_video" : "get_image";
    return job.status === "SUCCEEDED"
      ? `The ${video ? "video" : "image"} is ready (job ${watch.targetId}). Call ${read} with jobId ${watch.targetId}${watch.projectId ? ` and projectId ${watch.projectId}` : ""} for its link and fileId.`
      : `The Studio job ended ${job.status} (job ${watch.targetId}); ${read} says why.`;
  }
  if (watch.kind === "background_run") {
    const run = await prisma.sokoBotTurn.findUnique({
      where: { id: watch.targetId },
      select: { status: true, finalAnswer: true, backgroundTitle: true },
    });
    if (!run) return "The background run no longer exists.";
    if (ACTIVE_TURN.has(run.status)) return null;
    return `The background run "${run.backgroundTitle ?? watch.targetId}" ended ${run.status}. Its report: ${clip(run.finalAnswer ?? "(none)")}`;
  }
  const replies = await prisma.chatRoomMessage.findMany({
    where: {
      roomId: watch.targetId,
      createdAt: { gt: watch.createdAt },
      deletedAt: null,
      OR: [
        { senderSokoBotId: null },
        { senderSokoBotId: { not: watch.sokoBotId } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: {
      content: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
      senderSokoBot: { select: { name: true } },
    },
  });
  if (replies.length === 0) return null;
  return clip(
    `New in the chat (room ${watch.targetId}):\n${replies
      .map(
        (reply) =>
          `- ${reply.senderUser?.name ?? reply.senderCoworker?.name ?? reply.senderSokoBot?.name ?? "Someone"}: ${clip(reply.content, 400)}`,
      )
      .join("\n")}`,
  );
}

/** The follow-up's brief: what it waited for, what came of it, and the plan. */
export function followUpMessage(input: {
  then: string;
  outcome: string;
  timedOut: boolean;
}): string {
  return [
    "Follow-up: something you were waiting for is done.",
    input.timedOut
      ? `It did not finish in time. Where it stands: ${input.outcome}`
      : input.outcome,
    "",
    `Your plan: ${input.then}`,
    "",
    "Carry the plan out now with the tools you have; the owner already asked for it, so do not ask again. If it no longer makes sense (the work failed or timed out), say so plainly instead. Your answer is posted in the chat where it was asked: start it with DONE: and say in one or two sentences what you did, with links.",
  ].join("\n");
}

/**
 * wait_for: records what to wait on and what to do then. Owner requests only,
 * like a background run, since the follow-up runs as one. Something already
 * done is said so at once, for the bot to act on in this turn.
 */
export async function registerWatch(
  authorized: AuthorizedSokoBotRuntime,
  input: WaitForInput,
) {
  if (authorized.reader.sharedScope)
    throw new SokoBotRuntimeValidationError(
      "A shared Soko Bot cannot wait in the background; do the next step when someone asks again.",
    );
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: authorized.turn.id },
    select: { parentTurnId: true, askedByUserId: true, chainDepth: true },
  });
  if (turn.askedByUserId || turn.chainDepth > 0)
    throw new SokoBotRuntimeValidationError(
      "Only the owner's own requests can wait in the background.",
    );
  // A follow-up may wait again (post, then wait for the replies); its own
  // follow-up belongs to the turn the owner asked in. A plain background run
  // waits inside itself.
  let originTurnId = authorized.turn.id;
  if (turn.parentTurnId) {
    const parentWatch = await prisma.sokoBotWatch.findFirst({
      where: { firedTurnId: authorized.turn.id },
      select: { turnId: true },
    });
    if (!parentWatch)
      throw new SokoBotRuntimeValidationError(
        "A background run waits inside itself; check again later in this run.",
      );
    originTurnId = parentWatch.turnId;
  }
  const { sokoBotId, workspaceId } = authorized.turn;
  const waiting = await prisma.sokoBotWatch.count({
    where: { sokoBotId, status: "WAITING" },
  });
  if (waiting >= MAX_WAITING_PER_BOT)
    throw new SokoBotRuntimeValidationError(
      `${MAX_WAITING_PER_BOT} background checks are already waiting; let one finish first.`,
    );

  if (input.kind === "studio_job") {
    if (!input.projectId)
      throw new SokoBotRuntimeValidationError(
        "projectId is required to wait for a Studio job.",
      );
    const job = await prisma.projectImageJob.findFirst({
      where: { id: input.id, projectId: input.projectId, workspaceId },
      select: { id: true },
    });
    if (!job)
      throw new SokoBotRuntimeValidationError(
        "No Studio job with that jobId in that Project; use the jobId generate_image or generate_video returned.",
      );
  } else if (input.kind === "background_run") {
    const run = await prisma.sokoBotTurn.findFirst({
      where: { id: input.id, sokoBotId, parentTurnId: { not: null } },
      select: { id: true },
    });
    if (!run)
      throw new SokoBotRuntimeValidationError(
        "No background run of yours with that runId.",
      );
  } else {
    const member = await prisma.chatRoomSokoBotMember.findUnique({
      where: { roomId_sokoBotId: { roomId: input.id, sokoBotId } },
      select: { id: true },
    });
    if (!member)
      throw new SokoBotRuntimeValidationError(
        "You are not in that chat room; use a roomId from list_chats or ask_coworker.",
      );
  }

  const now = new Date();
  const draft = {
    kind: input.kind,
    targetId: input.id,
    projectId: input.projectId ?? null,
    sokoBotId,
    createdAt: now,
  };
  // A chat reply is about what comes next, so it never counts as done yet.
  const already =
    input.kind === "chat_reply" ? null : await watchOutcome(draft);
  if (already)
    return {
      waiting: false,
      outcome: already,
      note: "It is already done: do the next step now, in this turn.",
    };
  const timeoutMinutes = input.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
  const watch = await prisma.sokoBotWatch.create({
    data: {
      ...draft,
      turnId: originTurnId,
      then: input.then,
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000),
    },
    select: { id: true, expiresAt: true },
  });
  return {
    waiting: true,
    watchId: watch.id,
    until: watch.expiresAt,
    note: "Waiting in the background. End your turn now and tell the owner in one sentence what happens once it is done; the follow-up posts its answer in this chat.",
  };
}

export interface SokoBotWatchesSyncResult {
  checked: number;
  fired: number;
  deferred: number;
  failed: number;
}

/**
 * Every minute: each waiting check whose target is done, or whose time ran
 * out, starts its follow-up as a background run of the turn that set it, with
 * that turn's tools, posting where it was asked. The claim (WAITING → FIRED)
 * comes first, so a follow-up starts once; a busy bot puts it back for the
 * next tick.
 */
export async function syncSokoBotWatches(input: {
  shouldContinue: () => boolean;
}): Promise<SokoBotWatchesSyncResult> {
  const result: SokoBotWatchesSyncResult = {
    checked: 0,
    fired: 0,
    deferred: 0,
    failed: 0,
  };
  const watches = await prisma.sokoBotWatch.findMany({
    where: { status: "WAITING" },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      kind: true,
      targetId: true,
      projectId: true,
      sokoBotId: true,
      createdAt: true,
      expiresAt: true,
      then: true,
      turn: {
        select: {
          id: true,
          requestedByUserId: true,
          workspaceId: true,
          source: true,
          versionId: true,
          capabilityNames: true,
          destinationRoomId: true,
        },
      },
    },
  });
  const { sokoBotControlPlane, SokoBotBusyError } = await import(
    "@/services/soko-bot-control-plane.service"
  );
  for (const watch of watches) {
    if (!input.shouldContinue()) break;
    result.checked += 1;
    const outcome = await watchOutcome(watch).catch(() => null);
    const timedOut = !outcome && watch.expiresAt <= new Date();
    if (!outcome && !timedOut) continue;
    const claimed = await prisma.sokoBotWatch.updateMany({
      where: { id: watch.id, status: "WAITING" },
      data: {
        status: "FIRED",
        firedAt: new Date(),
        outcome: outcome ?? "timed out",
      },
    });
    if (claimed.count === 0) continue;
    const capabilities = watch.turn.capabilityNames.filter(
      (name): name is SokoBotCapability =>
        isSokoBotCapability(name) &&
        !RUN_MANAGEMENT_TOOLS.has(name as SokoBotCapability),
    );
    try {
      const started = await sokoBotControlPlane.startTurn({
        userId: watch.turn.requestedByUserId,
        sokoBotId: watch.sokoBotId,
        workspaceId: watch.turn.workspaceId,
        clientTurnId: `watch:${watch.id}`,
        message: followUpMessage({
          then: watch.then,
          outcome:
            outcome ??
            `still not done after ${Math.round((watch.expiresAt.getTime() - watch.createdAt.getTime()) / 60_000)} minutes.`,
          timedOut,
        }),
        source: watch.turn.source === "CHAT" ? "CHAT" : "SCHEDULE",
        versionId: watch.turn.versionId ?? undefined,
        presetRoute: {
          route: "DELEGATE_TASK",
          reason: `Follow-up: ${clip(watch.then, 80)}`,
          capabilities,
          sandbox: capabilities.some(isSokoBotSandboxCapability),
        },
        background: {
          parentTurnId: watch.turn.id,
          title: `Follow-up: ${clip(watch.then, 60)}`,
          destinationRoomId: watch.turn.destinationRoomId,
        },
      });
      await prisma.sokoBotWatch.update({
        where: { id: watch.id },
        data: { firedTurnId: started.turnId },
      });
      result.fired += 1;
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
              console.warn("Soko Bot follow-up reconciliation stopped", {
                turnId: started.turnId,
                error: error instanceof Error ? error.message : "unknown",
              });
            }),
        );
    } catch (error) {
      if (error instanceof SokoBotBusyError) {
        // Three runs at once, or the owner's limit: try again next tick.
        await prisma.sokoBotWatch.update({
          where: { id: watch.id },
          data: { status: "WAITING", firedAt: null, outcome: null },
        });
        result.deferred += 1;
        continue;
      }
      await prisma.sokoBotWatch.update({
        where: { id: watch.id },
        data: {
          status: "FAILED",
          outcome: clip(
            `${outcome ?? "timed out"} · could not start: ${error instanceof Error ? error.message : "unknown"}`,
          ),
        },
      });
      result.failed += 1;
      console.error("Soko Bot follow-up failed to start", {
        watchId: watch.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return result;
}
