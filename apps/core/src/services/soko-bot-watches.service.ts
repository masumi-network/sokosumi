import {
  isSokoBotSandboxCapability,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { createError } from "evlog";
import type { z } from "zod";
import { jsonInput } from "@/helpers/prisma-json";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import {
  createCoreLogger,
  logCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { failOpen } from "@/lib/fail-open";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { sokoBotActingUserId } from "@/lib/soko-bot/acting-user";
import {
  DetachedNetworkRefusal,
  detachedNetworkScope,
  turnProvenance,
} from "@/lib/soko-bot/detached-network";
import {
  capabilitiesForWatchFollowUp,
  deriveWatchAuthority,
  isOwnerAuthorityRevoked,
  type OwnerAuthorityAskedByKind,
  resolveWatchWakeAuthority,
} from "@/lib/soko-bot/owner-authority";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

type WaitForInput = z.infer<(typeof SOKO_BOT_TOOL_INPUT_SCHEMAS)["wait_for"]>;

const DEFAULT_TIMEOUT_MINUTES = 60;
/** A position check takes minutes; one still running after this is reported as slow. */
const SEO_CHECK_TIMEOUT_MINUTES = 45;
/** Someone may connect the app later in the day; no one needs a reminder. */
const APP_CONNECTED_TIMEOUT_MINUTES = 1_440;
const PROVIDER_SLUG = /^[a-z0-9_-]{1,64}$/;
/** Waits one bot may hold at once; more is a loop, not a plan. */
const MAX_WAITING_PER_BOT = 25;
const BATCH = 50;
const OUTCOME_CHARS = 1_500;
/**
 * Everything the other side said is the follow-up's whole point: at 400
 * characters Hannah's 560-character list ended on "(Bit…", and a 6,000-
 * character comparison lost its bottom line at 4,000. One reply may use the
 * whole budget; what still does not fit is marked as cut.
 */
const REPLIES_CHARS = 24_000;
const REPLY_MESSAGES = 20;
/** People type in bursts: their answer counts once they paused this long. */
const PERSON_PAUSE_MS = 90_000;
const ANSWERING_MENTION = ["staged", "pending", "sent"];
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

/** A Coworker's reply carries `streaming` in its metadata while it is written. */
function isBeingWritten(message: { metadata: unknown }): boolean {
  const { metadata } = message;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "streaming" in metadata &&
    metadata.streaming === true
  );
}

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
    const video =
      job.kind === "TEXT_TO_VIDEO" ||
      job.kind === "IMAGE_TO_VIDEO" ||
      job.kind === "TALKING_VIDEO";
    const read = video ? "get_video" : "get_image";
    return job.status === "SUCCEEDED"
      ? `The ${video ? "video" : "image"} is ready (job ${watch.targetId}). Call ${read} with jobId ${watch.targetId}${watch.projectId ? ` and projectId ${watch.projectId}` : ""} for its link and fileId.`
      : `The Studio job ended ${job.status} (job ${watch.targetId}); ${read} says why.`;
  }
  if (watch.kind === "seo_check") {
    const { seoCheckOutcome } = await import(
      "@/services/cmo-seo-rankings.service"
    );
    return seoCheckOutcome(watch.targetId);
  }
  if (watch.kind === "app_connected") {
    const integration = await prisma.sokoBotIntegration.findUnique({
      where: {
        sokoBotId_provider: {
          sokoBotId: watch.sokoBotId,
          provider: watch.targetId,
        },
      },
      select: { status: true },
    });
    return integration?.status === "ACTIVE"
      ? `${watch.targetId} is connected now. Call list_integration_tools with provider ${watch.targetId}, then run_integration_tool.`
      : null;
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
  return chatReplyOutcome(watch);
}

/**
 * A chat wait is done once everyone the bot asked has finished: every
 * Coworker or assistant it mentioned since its question has answered or
 * failed, nothing is still being written, and a person's last message is a
 * pause old. The follow-up then gets everything they said since the question,
 * whole, with who did not answer.
 */
export async function chatReplyOutcome(
  watch: { targetId: string; sokoBotId: string; createdAt: Date },
  options: { partial?: boolean } = {},
): Promise<string | null> {
  const roomId = watch.targetId;
  const question = await prisma.chatRoomMessage.findFirst({
    where: {
      roomId,
      senderSokoBotId: watch.sokoBotId,
      createdAt: { lte: watch.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since =
    question &&
    watch.createdAt.getTime() - question.createdAt.getTime() < 60 * 60_000
      ? question.createdAt
      : watch.createdAt;
  const mentions = await prisma.chatRoomMention.findMany({
    where: {
      message: {
        roomId,
        senderSokoBotId: watch.sokoBotId,
        createdAt: { gte: since },
      },
    },
    select: {
      status: true,
      error: true,
      coworker: { select: { name: true } },
      sokoBot: { select: { name: true } },
    },
  });
  const answering = mentions.filter((mention) =>
    ANSWERING_MENTION.includes(mention.status),
  );
  if (answering.length > 0 && !options.partial) return null;
  const replies = await prisma.chatRoomMessage.findMany({
    where: {
      roomId,
      createdAt: { gt: since },
      deletedAt: null,
      // A Coworker's reply starts empty and fills as it is written.
      content: { not: "" },
      OR: [
        { senderSokoBotId: null },
        { senderSokoBotId: { not: watch.sokoBotId } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: REPLY_MESSAGES + 1,
    select: {
      content: true,
      metadata: true,
      createdAt: true,
      senderUserId: true,
      senderUser: { select: { name: true } },
      senderCoworker: { select: { name: true } },
      senderSokoBot: { select: { name: true } },
    },
  });
  const written = replies.filter((reply) => !isBeingWritten(reply));
  // A reply still being written is no answer yet: the next check reads it.
  if (written.length < replies.length && !options.partial) return null;
  const failed = mentions.filter((mention) => mention.status === "failed");
  if (written.length === 0 && failed.length === 0 && !options.partial)
    return null;
  const lastByPerson = written.findLast((reply) => reply.senderUserId);
  if (
    !options.partial &&
    lastByPerson &&
    (await databaseNow()).getTime() - lastByPerson.createdAt.getTime() <
      PERSON_PAUSE_MS
  )
    return null;
  const shown = written.slice(0, REPLY_MESSAGES);
  const lines: string[] = [];
  let left = REPLIES_CHARS;
  let cut = written.length > shown.length;
  for (const reply of shown) {
    const name =
      reply.senderUser?.name ??
      reply.senderCoworker?.name ??
      reply.senderSokoBot?.name ??
      "Someone";
    const text = reply.content.trim();
    const kept = text.slice(0, Math.max(0, left));
    left -= kept.length;
    if (kept.length < text.length) cut = true;
    lines.push(
      kept.length < text.length
        ? `- ${name}: ${kept}… [cut here: ${kept.length.toLocaleString("en-US")} of ${text.length.toLocaleString("en-US")} characters shown]`
        : `- ${name}: ${text}`,
    );
  }
  const who = (mention: (typeof mentions)[number]) =>
    mention.coworker?.name ?? mention.sokoBot?.name ?? "Someone";
  const silent = [
    ...failed.map(
      (mention) =>
        `${who(mention)} did not answer${mention.error ? ` (${clip(mention.error, 120)})` : ""}.`,
    ),
    ...answering.map((mention) => `${who(mention)} is still answering.`),
  ];
  return [
    shown.length
      ? `Everything said in the chat since your question (room ${roomId}), in full:`
      : `No answer in the chat (room ${roomId}).`,
    ...lines,
    ...silent,
    cut
      ? `Not all of it fit: what is marked cut is cut, so say so when you pass it on rather than presenting it as everything.`
      : "That is all of it; nothing was cut.",
  ].join("\n");
}

/** The asking turn's tools a follow-up keeps, unified through OwnerAuthority. */
export function followUpCapabilities(
  kind: string,
  names: string[],
): SokoBotCapability[] {
  return capabilitiesForWatchFollowUp(kind, names);
}

/**
 * How the follow-up of an SEO check ends: its message is the answer the
 * owner has waited for, never a note that the answer exists.
 */
const SEO_CHECK_ANSWER =
  "The reply you write at the end of this turn is the message the owner reads: Core posts it in the chat where they asked, so you post nothing yourself and look for no chat room, whatever your plan says about where to answer. Write the answer itself, in full, in the language they asked in: where the site ranks, with the date (or that it is not among the results checked, and how many were), who ranks above, and two or three concrete next steps from the numbers the tools return. Save a page change or an article that follows with save_seo_suggestions and say it is in the SEO tab. Never write that the result or the steps are covered, done or available: say them. If the check failed or did not finish, say that first, give the numbers you have, and ask whether to check again; start no new check now. Start the answer with DONE: and go straight on with the answer.";

/** The follow-up's brief: what it waited for, what came of it, and the plan. */
export function followUpMessage(input: {
  then: string;
  outcome: string;
  timedOut: boolean;
  kind?: string;
}): string {
  return [
    "Follow-up: something you were waiting for is done.",
    input.timedOut
      ? `It did not finish in time. Where it stands: ${input.outcome}`
      : input.outcome,
    "",
    `Your plan: ${input.then}`,
    "",
    input.kind === "seo_check"
      ? SEO_CHECK_ANSWER
      : "Carry the plan out now with the tools you have; it was already asked for, so do not ask again. If it no longer makes sense (the work failed or timed out), say so plainly instead. Your answer is posted in the chat where it was asked: to deliver something there (an image, a file), attach it to this answer with preview_result rather than post_chat. Start the answer with DONE: and say in one or two sentences what you did, with links.",
  ].join("\n");
}

/**
 * wait_for: records what to wait on and what to do then, for any turn. The
 * follow-up runs for whoever asked, with their turn's tools and audience.
 * Something already done is said so at once, for the bot to act on in this
 * turn.
 */
/**
 * A follow-up or background run may wait too (post, then wait for the
 * replies); its follow-up belongs to the turn that was asked, so it keeps
 * that turn's tools and posts where it was asked.
 */
export async function watchOriginTurnId(turnId: string): Promise<string> {
  const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
    where: { id: turnId },
    select: { parentTurnId: true },
  });
  if (!turn.parentTurnId) return turnId;
  const parentWatch = await prisma.sokoBotWatch.findFirst({
    where: { firedTurnId: turnId },
    select: { turnId: true },
  });
  return parentWatch?.turnId ?? turn.parentTurnId;
}

/**
 * A position check Cuso asked the SEO specialist for: his follow-up answers
 * the owner in the chat it was asked in once the result is imported, or says
 * it failed or did not finish in time.
 */
export async function registerSeoCheckWatch(
  authorized: AuthorizedSokoBotRuntime,
  input: { analysisId: string; projectId: string; then: string },
) {
  const { sokoBotId } = authorized.turn;
  const waiting = await prisma.sokoBotWatch.findFirst({
    where: {
      sokoBotId,
      kind: "seo_check",
      targetId: input.analysisId,
      status: "WAITING",
    },
    select: { id: true },
  });
  if (waiting) return;
  const watchAuthority = await deriveWatchAuthority(
    {
      id: authorized.turn.id,
      sokoBotId: authorized.turn.sokoBotId,
      workspaceId: authorized.turn.workspaceId,
      versionId: authorized.turn.versionId,
      source: authorized.turn.source,
      clientTurnId: authorized.turn.clientTurnId ?? null,
      parentTurnId: authorized.turn.parentTurnId ?? null,
      askedByUserId: authorized.turn.askedByUserId ?? null,
      requestedByUserId: authorized.turn.requestedByUserId,
      actingUserId: authorized.turn.actingUserId,
      chainDepth: authorized.turn.chainDepth,
      askedByKind: authorized.askedByKind,
      botProjectId: authorized.turn.botProjectId ?? null,
    },
    { kind: "seo_check", projectId: input.projectId },
    prisma,
  );
  await prisma.sokoBotWatch.create({
    data: {
      sokoBotId,
      turnId: await watchOriginTurnId(authorized.turn.id),
      kind: "seo_check",
      targetId: input.analysisId,
      projectId: input.projectId,
      then: input.then,
      expiresAt: new Date(Date.now() + SEO_CHECK_TIMEOUT_MINUTES * 60_000),
      authority: jsonInput(watchAuthority),
    },
  });
}

export async function registerWatch(
  authorized: AuthorizedSokoBotRuntime,
  input: WaitForInput,
) {
  const originTurnId = await watchOriginTurnId(authorized.turn.id);
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
  } else if (input.kind === "app_connected") {
    if (!PROVIDER_SLUG.test(input.id))
      throw new SokoBotRuntimeValidationError(
        "Use the app's provider from find_integrations, like hubspot.",
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
  const timeoutMinutes =
    input.timeoutMinutes ??
    (input.kind === "app_connected"
      ? APP_CONNECTED_TIMEOUT_MINUTES
      : DEFAULT_TIMEOUT_MINUTES);
  const watchAuthority = await deriveWatchAuthority(
    {
      id: authorized.turn.id,
      sokoBotId: authorized.turn.sokoBotId,
      workspaceId: authorized.turn.workspaceId,
      versionId: authorized.turn.versionId,
      source: authorized.turn.source,
      clientTurnId: authorized.turn.clientTurnId ?? null,
      parentTurnId: authorized.turn.parentTurnId ?? null,
      askedByUserId: authorized.turn.askedByUserId ?? null,
      requestedByUserId: authorized.turn.requestedByUserId,
      actingUserId: authorized.turn.actingUserId,
      chainDepth: authorized.turn.chainDepth,
      askedByKind: authorized.askedByKind,
      botProjectId: authorized.turn.botProjectId ?? null,
    },
    { kind: input.kind, projectId: input.projectId ?? null },
    prisma,
  );
  const watch = await prisma.sokoBotWatch.create({
    data: {
      ...draft,
      turnId: originTurnId,
      then: input.then,
      expiresAt: new Date(now.getTime() + timeoutMinutes * 60_000),
      authority: jsonInput(watchAuthority),
    },
    select: { id: true, expiresAt: true },
  });
  return {
    waiting: true,
    watchId: watch.id,
    until: watch.expiresAt,
    note: "Waiting in the background. Finish any other step you can do now, then end your turn and say in one sentence what happens once it is done; the follow-up posts its answer in this chat.",
  };
}

/**
 * An app was just connected: the latest answer of the past day that gave its
 * connect link gets a follow-up, so the bot finishes that request without
 * being asked again. A wait the bot set itself is used as it is.
 */
export async function followUpConnectedApp(
  sokoBotId: string,
  provider: string,
): Promise<void> {
  if (!PROVIDER_SLUG.test(provider)) return;
  // PostgreSQL time: the turns' createdAt is.
  const since = new Date(
    (await databaseNow()).getTime() - APP_CONNECTED_TIMEOUT_MINUTES * 60_000,
  );
  const linked = new RegExp(`[?&]connect=${provider}(?![a-z0-9_-])`);
  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId,
      createdAt: { gte: since },
      finalAnswer: { contains: `connect=${provider}` },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      userMessage: true,
      finalAnswer: true,
      sokoBotId: true,
      workspaceId: true,
      versionId: true,
      source: true,
      parentTurnId: true,
      askedByUserId: true,
      requestedByUserId: true,
      chainDepth: true,
      sokoBot: { select: { userId: true, projectId: true } },
    },
  });
  const turn = turns.find((row) => linked.test(row.finalAnswer ?? ""));
  if (turn) {
    const set = await prisma.sokoBotWatch.findFirst({
      where: { turnId: turn.id, kind: "app_connected", targetId: provider },
      select: { id: true },
    });
    if (!set) {
      const watchAuthority =
        turn.workspaceId && turn.sokoBotId
          ? await deriveWatchAuthority(
              {
                id: turn.id,
                sokoBotId: turn.sokoBotId,
                workspaceId: turn.workspaceId,
                versionId: turn.versionId ?? null,
                source: turn.source ?? "CHAT",
                parentTurnId: turn.parentTurnId ?? null,
                askedByUserId: turn.askedByUserId ?? null,
                requestedByUserId: turn.requestedByUserId ?? null,
                actingUserId: sokoBotActingUserId({
                  requestedByUserId: turn.requestedByUserId ?? null,
                  sokoBot: {
                    userId:
                      turn.sokoBot?.userId ?? turn.requestedByUserId ?? null,
                  },
                }),
                chainDepth: turn.chainDepth ?? 0,
                botProjectId: turn.sokoBot?.projectId ?? null,
              },
              { kind: "app_connected" },
              prisma,
            )
          : undefined;
      await prisma.sokoBotWatch.create({
        data: {
          sokoBotId,
          turnId: turn.id,
          kind: "app_connected",
          targetId: provider,
          then: `Finish what was asked, which needed ${provider}: "${clip(turn.userMessage, 1_000)}"`,
          expiresAt: new Date(Date.now() + 5 * 60_000),
          ...(watchAuthority ? { authority: jsonInput(watchAuthority) } : {}),
        },
      });
    }
  }
  await syncSokoBotWatches({ shouldContinue: () => true, sokoBotId });
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
 * next tick. `sokoBotId` checks one bot's waits now, as when an app connects.
 * An app nobody connected in time just ends: there is nothing to follow up.
 */
/** Runs in the events cron or after a response, so its events stand alone. */
const OPERATION = "soko_bot_watches_sync";

export async function syncSokoBotWatches(input: {
  shouldContinue: () => boolean;
  sokoBotId?: string;
}): Promise<SokoBotWatchesSyncResult> {
  const result: SokoBotWatchesSyncResult = {
    checked: 0,
    fired: 0,
    deferred: 0,
    failed: 0,
  };
  const watches = await prisma.sokoBotWatch.findMany({
    where: {
      status: "WAITING",
      ...(input.sokoBotId ? { sokoBotId: input.sokoBotId } : {}),
    },
    orderBy: [
      { turn: { network: { sort: "asc", nulls: "first" } } },
      { createdAt: "asc" },
    ],
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
      authority: true,
      turn: {
        select: {
          id: true,
          network: true,
          preprodGeneration: true,
          requestedByUserId: true,
          askedByUserId: true,
          chainDepth: true,
          workspaceId: true,
          source: true,
          versionId: true,
          capabilityNames: true,
          destinationRoomId: true,
          sokoBot: { select: { userId: true, projectId: true } },
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
    try {
      await detachedNetworkScope(watch.turn);
    } catch (error) {
      if (error instanceof DetachedNetworkRefusal && !error.final) {
        result.deferred += 1;
        continue;
      }
      const failed = await prisma.sokoBotWatch.updateMany({
        where: { id: watch.id, status: "WAITING" },
        data: {
          status: "FAILED",
          outcome: clip(
            error instanceof Error ? error.message : "Unknown Network",
          ),
        },
      });
      result.failed += failed.count;
      continue;
    }
    const done = await watchOutcome(watch).catch(
      failOpen(
        null,
        {
          operation: "soko_bot_watch",
          watch: { id: watch.id, kind: watch.kind },
        },
        {
          message: "A Soko Bot background check could not be read",
          why: "Checking the watch threw, so it counted as not done yet",
          fix: "The next sync checks it again until it expires; read the failure fields if it repeats.",
        },
      ),
    );
    const timedOut = !done && watch.expiresAt <= new Date();
    if (!done && !timedOut) continue;
    // A wait that ran out still hands over what was said so far.
    const outcome =
      done ??
      (watch.kind === "chat_reply"
        ? await chatReplyOutcome(watch, { partial: true }).catch(
            failOpen(
              null,
              {
                operation: "soko_bot_watch",
                watch: { id: watch.id, kind: watch.kind },
              },
              {
                message:
                  "A Soko Bot background check expired without its partial reply",
                why: "Reading what was said so far threw",
                fix: "The watch expires without the partial reply; read the failure fields.",
              },
            ),
          )
        : null);
    if (!outcome && watch.kind === "app_connected") {
      await prisma.sokoBotWatch.updateMany({
        where: { id: watch.id, status: "WAITING" },
        data: { status: "EXPIRED", outcome: "never connected" },
      });
      continue;
    }
    const claimed = await prisma.sokoBotWatch.updateMany({
      where: { id: watch.id, status: "WAITING" },
      data: {
        status: "FIRED",
        firedAt: new Date(),
        outcome: outcome ?? "timed out",
      },
    });
    if (claimed.count === 0) continue;
    const watchAuthority = resolveWatchWakeAuthority(watch);
    const sharedBot = watch.turn.sokoBot?.userId === null;
    const actingUserId = sokoBotActingUserId({
      requestedByUserId: watch.turn.requestedByUserId,
      sokoBot: {
        userId: watch.turn.sokoBot?.userId ?? watch.turn.requestedByUserId,
      },
    });
    const askedByKind: OwnerAuthorityAskedByKind =
      watch.turn.chainDepth > 0
        ? "ASSISTANT"
        : watch.turn.askedByUserId !== null &&
            watch.turn.askedByUserId !== watch.turn.requestedByUserId
          ? "TEAMMATE"
          : sharedBot
            ? "TEAMMATE"
            : "OWNER";
    const liveProjectId =
      watch.projectId ?? watch.turn.sokoBot?.projectId ?? null;
    const revoked = await isOwnerAuthorityRevoked(watchAuthority, prisma);
    const capabilities = capabilitiesForWatchFollowUp(
      watch.kind,
      watch.turn.capabilityNames,
      {
        authority: watchAuthority,
        live: {
          sokoBotId: watch.sokoBotId,
          workspaceId: watch.turn.workspaceId,
          versionId: watch.turn.versionId,
          actingUserId,
          askedByKind,
          sharedBot,
          source: watch.turn.source === "CHAT" ? "CHAT" : "SCHEDULE",
          ...(watchAuthority.scheduleId
            ? { scheduleId: watchAuthority.scheduleId }
            : {}),
          ...(liveProjectId
            ? {
                targetScope: {
                  kind: "project" as const,
                  projectId: liveProjectId,
                },
              }
            : {}),
          hasWorkspaceAccess: true,
          botAlive: true,
          ...(revoked ? { revoked: true } : {}),
        },
      },
    );
    try {
      const started = await sokoBotControlPlane.startTurn({
        ...turnProvenance(watch.turn),
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
          kind: watch.kind,
        }),
        source: watch.turn.source === "CHAT" ? "CHAT" : "SCHEDULE",
        versionId: watch.turn.versionId ?? undefined,
        presetRoute: {
          route: "DELEGATE_TASK",
          reason: `Follow-up: ${clip(watch.then, 80)}`,
          capabilities,
          sandbox: capabilities.some(isSokoBotSandboxCapability),
        },
        // Whoever asked the first turn still asks: a teammate's or another
        // bot's follow-up keeps their audience, never the owner's.
        ...(watch.turn.askedByUserId || watch.turn.chainDepth > 0
          ? {
              chat: {
                askedByUserId: watch.turn.askedByUserId,
                askedByBot: watch.turn.chainDepth > 0,
                chainDepth: watch.turn.chainDepth,
              },
            }
          : {}),
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
      const { reconciliationLeaseToken } = started;
      if (
        reconciliationLeaseToken &&
        (started.status === "STARTING" || started.status === "RUNNING")
      )
        waitUntil(
          runAsBackgroundWork(() =>
            sokoBotControlPlane
              .reconcileTurn(
                started.turnId,
                undefined,
                reconciliationLeaseToken,
              )
              .catch((error: unknown) => {
                if (reportSokoBotReconciliationLeaseLoss(started.turnId, error))
                  return;
                const log = createCoreLogger({
                  operation: OPERATION,
                  watch: { id: watch.id },
                  turn: { id: started.turnId },
                });
                logCoreWarning(
                  log,
                  {
                    message:
                      "A Soko Bot follow-up stopped draining before it finished",
                    why: "Turn reconciliation threw",
                    fix: "The soko-bot-turns sync resumes the turn. If it stays stuck, read the turn's events.",
                  },
                  // The raw error is redacted detail, never the why.
                  { failure: messageSafeErrorFields(error) },
                );
                log.emit();
              }),
          ),
        );
    } catch (error) {
      if (
        error instanceof SokoBotBusyError ||
        (error instanceof DetachedNetworkRefusal && !error.final)
      ) {
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
      const log = createCoreLogger({
        operation: OPERATION,
        watch: { id: watch.id },
        sokoBot: { id: watch.sokoBotId },
      });
      log.error(
        createError({
          message: "Could not start a Soko Bot follow-up",
          why: "Starting the turn failed",
          fix: "The wait is marked FAILED with the reason, so the owner sees it. If many fail, check failure.errorName and failure.status.",
        }),
        // Only safe fields: turn work can echo its prompt.
        { failure: messageSafeErrorFields(error) },
      );
      log.emit();
    }
  }
  return result;
}
