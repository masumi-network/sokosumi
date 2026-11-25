import prisma from "@/lib/db/prisma";
import { HELD_BACK_REPLY } from "@/lib/soko-bot/action-response";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import { listCusosWithApprovedStrategy } from "@/services/cmo-cuso.service";
import {
  cmoConnectedChannels,
  readCmoProduction,
} from "@/services/cmo-production.service";

/**
 * The weekly failure review CodePat reads (docs/coworker/failure-review.md):
 * what failed in a window, grouped by a stable cause key, with last window's
 * count beside it. It quotes no message, post, mail or prompt: every text is
 * cut to its first line with quotes, URLs, emails, ids and numbers taken out.
 */

export const FAILURE_REVIEW_GROUPS = 15;
export const FAILURE_REVIEW_EXAMPLES = 3;
const ROWS_PER_SOURCE = 5_000;
const DETAIL_CHARS = 140;
const ORPHAN_GRACE_MS = 10 * 60 * 1_000;

export interface FailureExample {
  id: string;
  at: string;
  /** Ids that lead to the row's context: turn, bot, schedule, project, run. */
  refs: Record<string, string>;
}

export interface FailureGroup {
  key: string;
  count: number;
  previousCount: number;
  examples: FailureExample[];
}

export interface FailureRow {
  key: string;
  id: string;
  at: Date;
  previous: boolean;
  refs?: Record<string, string | null | undefined>;
}

export interface CmoMonthProblem {
  sokoBotId: string;
  projectId: string;
  projectName: string;
  state: string;
  ready: number;
  total: number;
  withoutPicture: number;
  failedMedia: number;
  retryAt: string | null;
}

export interface FailureReview {
  window: { since: string; until: string; previousSince: string };
  sections: {
    turns: FailureGroup[];
    mentions: FailureGroup[];
    replyChecks: FailureGroup[];
    toolCalls: FailureGroup[];
    posting: FailureGroup[];
    media: FailureGroup[];
    schedules: FailureGroup[];
    evals: FailureGroup[];
  };
  cmoMonths: CmoMonthProblem[];
  notCovered: string[];
}

const NOT_COVERED = [
  "Replies withheld for claiming an unconfirmed change are only logged: Vercel logs of sokosumi-core-mainnet, message 'Withheld a Soko Bot reply' (operation soko_bot_reply_check). This report counts only replies held back unchecked.",
  "Errors that never reach a row (a cron that throws, a 500 on a route) are in Vercel logs and Sentry, not here.",
];

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * An error text as a cause, safe to show: the first line (plus the last when
 * the first only introduces it, as Prisma's do), without quoted text, URLs,
 * emails, ids or numbers, so rows that differ only in those group together.
 */
export function causeText(text: string | null | undefined): string {
  const lines = (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const first = lines[0] ?? "";
  const line =
    first.endsWith(":") && lines.length > 1
      ? `${first} ${lines.at(-1)}`
      : first;
  return line
    .replace(EMAIL, "[email]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/"[^"]*"|“[^”]*”|«[^»]*»|„[^“”]*[“”]/g, '"…"')
    .replace(UUID, "[id]")
    .replace(/\d+([.,]\d+)*/g, "N")
    .replace(/\s+/g, " ")
    .slice(0, DETAIL_CHARS);
}

/** A turn's kind from its client id: `schedule`, `chat`, `cmo:production`, … */
export function turnKind(clientTurnId: string): string {
  const [first = "", second] = clientTurnId.split(":");
  return first === "cmo" && second ? `cmo:${second}` : first;
}

/** Rows to groups: biggest first, capped, a few newest examples each. */
export function groupFailures(rows: readonly FailureRow[]): FailureGroup[] {
  const groups = new Map<
    string,
    { count: number; previousCount: number; rows: FailureRow[] }
  >();
  for (const row of rows) {
    const group = groups.get(row.key) ?? {
      count: 0,
      previousCount: 0,
      rows: [],
    };
    if (row.previous) group.previousCount += 1;
    else {
      group.count += 1;
      group.rows.push(row);
    }
    groups.set(row.key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.count > 0)
    .sort(
      ([keyA, a], [keyB, b]) =>
        b.count - a.count ||
        b.count - b.previousCount - (a.count - a.previousCount) ||
        keyA.localeCompare(keyB),
    )
    .slice(0, FAILURE_REVIEW_GROUPS)
    .map(([key, group]) => ({
      key,
      count: group.count,
      previousCount: group.previousCount,
      examples: group.rows
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, FAILURE_REVIEW_EXAMPLES)
        .map((row) => ({
          id: row.id,
          at: row.at.toISOString(),
          refs: Object.fromEntries(
            Object.entries(row.refs ?? {}).filter(
              (entry): entry is [string, string] => Boolean(entry[1]),
            ),
          ),
        })),
    }));
}

interface Window {
  since: Date;
  until: Date;
  previousSince: Date;
}

const key = (...parts: (string | null | undefined)[]) =>
  parts.map((part) => part || "-").join(" · ");

/** Jev's wanted route on a CLARIFY reroute: "Jev: unsure (MANAGE_WORK at 43%)". */
function clarifyCause(classification: unknown, failed: boolean): string {
  if (failed) return "classification failed";
  const summary =
    classification && typeof classification === "object"
      ? (classification as { rationaleSummary?: unknown }).rationaleSummary
      : undefined;
  const wanted =
    typeof summary === "string" ? /unsure \((\w+)/.exec(summary)?.[1] : null;
  return wanted ? `unsure, wanted ${wanted}` : "asked to clarify";
}

async function turnRows(window: Window, evalWorkspaces: string[]) {
  const now = new Date();
  const [settled, orphaned] = await Promise.all([
    prisma.sokoBotTurn.findMany({
      where: {
        createdAt: { gte: window.previousSince, lt: window.until },
        status: { in: ["FAILED", "CANCELLED"] },
        workspaceId: { notIn: evalWorkspaces },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        clientTurnId: true,
        versionId: true,
        errorKind: true,
        errorDetail: true,
        sokoBotId: true,
      },
      orderBy: { createdAt: "desc" },
      take: ROWS_PER_SOURCE,
    }),
    prisma.sokoBotTurn.findMany({
      where: {
        deadlineAt: {
          gte: window.previousSince,
          lt: new Date(
            Math.min(window.until.getTime(), now.getTime() - ORPHAN_GRACE_MS),
          ),
        },
        status: { in: ["QUEUED", "STARTING", "RUNNING", "CANCEL_REQUESTED"] },
        workspaceId: { notIn: evalWorkspaces },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        clientTurnId: true,
        versionId: true,
        sokoBotId: true,
      },
      take: ROWS_PER_SOURCE,
    }),
  ]);
  return [
    ...settled.map((turn) => ({
      key: key(
        turn.status,
        turnKind(turn.clientTurnId),
        turn.versionId,
        turn.errorKind,
        causeText(turn.errorDetail),
      ),
      id: turn.id,
      at: turn.createdAt,
      previous: turn.createdAt < window.since,
      refs: { sokoBotId: turn.sokoBotId },
    })),
    ...orphaned.map((turn) => ({
      key: key(
        `ORPHANED ${turn.status}`,
        turnKind(turn.clientTurnId),
        turn.versionId,
      ),
      id: turn.id,
      at: turn.createdAt,
      previous: turn.createdAt < window.since,
      refs: { sokoBotId: turn.sokoBotId },
    })),
  ];
}

async function mentionRows(window: Window) {
  const mentions = await prisma.chatRoomMention.findMany({
    where: {
      updatedAt: { gte: window.previousSince, lt: window.until },
      status: "failed",
    },
    select: {
      id: true,
      updatedAt: true,
      error: true,
      sokoBotId: true,
      coworkerId: true,
    },
    take: ROWS_PER_SOURCE,
  });
  return mentions.map((mention) => ({
    key: key(
      mention.sokoBotId ? "soko bot" : "coworker",
      causeText(mention.error),
    ),
    id: mention.id,
    at: mention.updatedAt,
    previous: mention.updatedAt < window.since,
    refs: { sokoBotId: mention.sokoBotId, coworkerId: mention.coworkerId },
  }));
}

async function replyCheckRows(window: Window, evalWorkspaces: string[]) {
  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      createdAt: { gte: window.previousSince, lt: window.until },
      workspaceId: { notIn: evalWorkspaces },
      OR: [
        { route: "CLARIFY" },
        { finalAnswer: { contains: HELD_BACK_REPLY } },
      ],
    },
    select: {
      id: true,
      createdAt: true,
      route: true,
      clientTurnId: true,
      versionId: true,
      classification: true,
      classificationFailed: true,
      finalAnswer: true,
      sokoBotId: true,
    },
    take: ROWS_PER_SOURCE,
  });
  return turns.map((turn) => ({
    key: turn.finalAnswer?.includes(HELD_BACK_REPLY)
      ? key(
          "reply held back unchecked",
          turnKind(turn.clientTurnId),
          turn.versionId,
        )
      : key(
          "CLARIFY",
          turnKind(turn.clientTurnId),
          turn.versionId,
          clarifyCause(turn.classification, turn.classificationFailed),
        ),
    id: turn.id,
    at: turn.createdAt,
    previous: turn.createdAt < window.since,
    refs: { sokoBotId: turn.sokoBotId },
  }));
}

async function toolCallRows(window: Window, evalWorkspaces: string[]) {
  const calls = await prisma.sokoBotToolCall.findMany({
    where: {
      createdAt: { gte: window.previousSince, lt: window.until },
      status: "FAILED",
      turn: { workspaceId: { notIn: evalWorkspaces } },
    },
    select: {
      id: true,
      createdAt: true,
      capability: true,
      errorKind: true,
      errorDetail: true,
      turnId: true,
    },
    orderBy: { createdAt: "desc" },
    take: ROWS_PER_SOURCE,
  });
  return calls.map((call) => ({
    key: key(call.capability, call.errorKind, causeText(call.errorDetail)),
    id: call.id,
    at: call.createdAt,
    previous: call.createdAt < window.since,
    refs: { turnId: call.turnId },
  }));
}

async function postingRows(window: Window, evalWorkspaces: string[]) {
  const [attempts, posts] = await Promise.all([
    prisma.socialPostPublishAttempt.findMany({
      where: {
        startedAt: { gte: window.previousSince, lt: window.until },
        outcome: { not: "succeeded" },
        socialPost: { workspaceId: { notIn: evalWorkspaces } },
      },
      select: {
        id: true,
        startedAt: true,
        outcome: true,
        errorKind: true,
        providerOutcome: true,
        toolSlug: true,
        socialPostId: true,
      },
      take: ROWS_PER_SOURCE,
    }),
    prisma.socialPost.findMany({
      where: {
        updatedAt: { gte: window.previousSince, lt: window.until },
        status: { in: ["FAILED", "MISSED"] },
        workspaceId: { notIn: evalWorkspaces },
      },
      select: {
        id: true,
        updatedAt: true,
        status: true,
        provider: true,
        lastError: true,
        projectId: true,
      },
      take: ROWS_PER_SOURCE,
    }),
  ]);
  return [
    ...attempts.map((attempt) => ({
      key: key(
        "attempt",
        attempt.toolSlug,
        attempt.outcome,
        attempt.errorKind,
        causeText(attempt.providerOutcome),
      ),
      id: attempt.id,
      at: attempt.startedAt,
      previous: attempt.startedAt < window.since,
      refs: { socialPostId: attempt.socialPostId },
    })),
    ...posts.map((post) => ({
      key: key(`post ${post.status}`, post.provider, causeText(post.lastError)),
      id: post.id,
      at: post.updatedAt,
      previous: post.updatedAt < window.since,
      refs: { projectId: post.projectId },
    })),
  ];
}

async function mediaRows(window: Window, evalWorkspaces: string[]) {
  const jobs = await prisma.projectImageJob.findMany({
    where: {
      updatedAt: { gte: window.previousSince, lt: window.until },
      status: { in: ["FAILED", "ORPHANED", "SUBMISSION_UNCERTAIN"] },
      workspaceId: { notIn: evalWorkspaces },
    },
    select: {
      id: true,
      updatedAt: true,
      kind: true,
      status: true,
      error: true,
      projectId: true,
    },
    take: ROWS_PER_SOURCE,
  });
  return jobs.map((job) => ({
    key: key(job.kind, job.status, causeText(job.error)),
    id: job.id,
    at: job.updatedAt,
    previous: job.updatedAt < window.since,
    refs: { projectId: job.projectId },
  }));
}

function disabledScheduleId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const { enabled, scheduleId } = input as {
    enabled?: unknown;
    scheduleId?: unknown;
  };
  return enabled === false && typeof scheduleId === "string"
    ? scheduleId
    : null;
}

async function scheduleRows(window: Window, evalWorkspaces: string[]) {
  const [runs, changes] = await Promise.all([
    prisma.sokoBotScheduleRun.findMany({
      where: {
        updatedAt: { gte: window.previousSince, lt: window.until },
        status: { in: ["FAILED", "DEAD_LETTER"] },
        schedule: { workspaceId: { notIn: evalWorkspaces } },
      },
      select: {
        id: true,
        updatedAt: true,
        status: true,
        errorKind: true,
        errorDetail: true,
        scheduleId: true,
        turnId: true,
        schedule: { select: { systemKey: true } },
      },
      take: ROWS_PER_SOURCE,
    }),
    prisma.sokoBotToolCall.findMany({
      where: {
        createdAt: { gte: window.previousSince, lt: window.until },
        status: "COMPLETED",
        capability: { in: ["update_schedule", "delete_schedule"] },
        turn: { workspaceId: { notIn: evalWorkspaces } },
      },
      select: {
        id: true,
        createdAt: true,
        capability: true,
        input: true,
        turnId: true,
        turn: { select: { sokoBotId: true } },
      },
      take: ROWS_PER_SOURCE,
    }),
  ]);
  const stopped = changes.flatMap((call) => {
    const scheduleId =
      call.capability === "delete_schedule"
        ? (call.input as { scheduleId?: string } | null)?.scheduleId
        : disabledScheduleId(call.input);
    if (call.capability === "update_schedule" && !scheduleId) return [];
    return [
      {
        key: key(
          call.capability === "delete_schedule"
            ? "bot deleted a schedule"
            : "bot disabled a schedule",
        ),
        id: call.id,
        at: call.createdAt,
        previous: call.createdAt < window.since,
        refs: {
          scheduleId,
          turnId: call.turnId,
          sokoBotId: call.turn.sokoBotId,
        },
      },
    ];
  });
  return [
    ...runs.map((run) => ({
      key: key(
        `run ${run.status}`,
        run.schedule.systemKey ?? "custom",
        run.errorKind,
        causeText(run.errorDetail),
      ),
      id: run.id,
      at: run.updatedAt,
      previous: run.updatedAt < window.since,
      refs: { scheduleId: run.scheduleId, turnId: run.turnId },
    })),
    ...stopped,
  ];
}

async function evalRows(window: Window) {
  const results = await prisma.evalResult.findMany({
    where: {
      run: { createdAt: { gte: window.previousSince, lt: window.until } },
      status: { in: ["FAILED", "ERROR"] },
    },
    select: {
      id: true,
      createdAt: true,
      status: true,
      suite: true,
      caseId: true,
      error: true,
      runId: true,
      turnId: true,
      run: { select: { createdAt: true } },
    },
    take: ROWS_PER_SOURCE,
  });
  return results.map((result) => ({
    key: key(
      `${result.suite}/${result.caseId}`,
      result.status,
      ...(result.status === "ERROR" ? [causeText(result.error)] : []),
    ),
    id: result.id,
    at: result.createdAt,
    previous: result.run.createdAt < window.since,
    refs: { runId: result.runId, turnId: result.turnId },
  }));
}

/** Live Cusos whose approved month is stuck, blocked or short of pictures now. */
async function cmoMonthProblems(
  evalWorkspaces: string[],
): Promise<CmoMonthProblem[]> {
  const cusos = (await listCusosWithApprovedStrategy()).filter(
    (cuso) => !evalWorkspaces.includes(cuso.workspaceId),
  );
  const now = new Date();
  const problems: Omit<CmoMonthProblem, "projectName">[] = [];
  for (const cuso of cusos) {
    const read = await readCmoProduction(cuso, {
      connected: await cmoConnectedChannels(cuso.projectId),
      subscribed: await isCmoSubscribed(cuso, now),
      now,
    }).catch(() => null);
    if (!read) {
      problems.push({
        sokoBotId: cuso.sokoBotId,
        projectId: cuso.projectId,
        state: "unreadable",
        ready: 0,
        total: 0,
        withoutPicture: 0,
        failedMedia: 0,
        retryAt: null,
      });
      continue;
    }
    const { status, failedMedia } = read;
    if (
      status.state === "stuck" ||
      status.state === "blocked" ||
      status.withoutPicture.length > 0 ||
      failedMedia.size > 0
    )
      problems.push({
        sokoBotId: cuso.sokoBotId,
        projectId: cuso.projectId,
        state: status.state,
        ready: status.ready,
        total: status.total,
        withoutPicture: status.withoutPicture.length,
        failedMedia: failedMedia.size,
        retryAt: status.retryAt,
      });
  }
  const projects = await prisma.project.findMany({
    where: { id: { in: problems.map((problem) => problem.projectId) } },
    select: { id: true, name: true },
  });
  const names = new Map(projects.map((project) => [project.id, project.name]));
  return problems.slice(0, FAILURE_REVIEW_GROUPS).map((problem) => ({
    ...problem,
    projectName: causeText(names.get(problem.projectId) ?? ""),
  }));
}

/** The review of `[since, until)`, with `[since - length, since)` beside it. */
export async function readFailureReview(
  since: Date,
  until: Date,
): Promise<FailureReview> {
  const window: Window = {
    since,
    until,
    previousSince: new Date(
      since.getTime() - (until.getTime() - since.getTime()),
    ),
  };
  const evalWorkspaces = (
    await prisma.evalLane.findMany({ select: { workspaceId: true } })
  ).map((lane) => lane.workspaceId);
  const [
    turns,
    mentions,
    replyChecks,
    toolCalls,
    posting,
    media,
    schedules,
    evals,
    cmoMonths,
  ] = await Promise.all([
    turnRows(window, evalWorkspaces),
    mentionRows(window),
    replyCheckRows(window, evalWorkspaces),
    toolCallRows(window, evalWorkspaces),
    postingRows(window, evalWorkspaces),
    mediaRows(window, evalWorkspaces),
    scheduleRows(window, evalWorkspaces),
    evalRows(window),
    cmoMonthProblems(evalWorkspaces),
  ]);
  return {
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
      previousSince: window.previousSince.toISOString(),
    },
    sections: {
      turns: groupFailures(turns),
      mentions: groupFailures(mentions),
      replyChecks: groupFailures(replyChecks),
      toolCalls: groupFailures(toolCalls),
      posting: groupFailures(posting),
      media: groupFailures(media),
      schedules: groupFailures(schedules),
      evals: groupFailures(evals),
    },
    cmoMonths,
    notCovered: NOT_COVERED,
  };
}
