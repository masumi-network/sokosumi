import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  type AgentWithCreditsPrice,
  type Coworker,
  TaskStatus,
} from "@sokosumi/database";

import { compareTasksDesc } from "@/app/tasks/utils/task-sort";
import { getEnvSecrets } from "@/config/env.secrets";
import { taskService } from "@/lib/services/task.service";
import type { KanbanColumnId, TaskWithCoworker } from "@/lib/types/task";
import { COLUMN_TASK_STATUSES } from "@/lib/utils/task-column";
import { mapTaskToTaskWithCoworker } from "@/lib/utils/task-transformer";

type ColumnStreamState = {
  cursor: string | null;
  exhausted: boolean;
};

type ColumnPaginationState = {
  version: 2;
  streams: Partial<Record<TaskStatus, ColumnStreamState>>;
  buffer: TaskWithCoworker[];
};

export type ColumnCursor = string | null;

const CURSOR_STATE_VERSION = 2;
const MAX_CURSOR_BUFFER_SIZE = 500;
const MAX_CURSOR_PAYLOAD_BYTES = 250_000;

interface GetTasksColumnPageParams {
  columnId: KanbanColumnId;
  cursor: ColumnCursor;
  limit: number;
  coworkersById: Map<string, Coworker>;
  agentsById: Map<string, AgentWithCreditsPrice>;
}

interface GetTasksColumnPageResult {
  tasks: TaskWithCoworker[];
  nextCursor: ColumnCursor;
}

export async function getTasksColumnPage({
  columnId,
  cursor,
  limit,
  coworkersById,
  agentsById,
}: GetTasksColumnPageParams): Promise<GetTasksColumnPageResult> {
  // NOTE(maintainers): This function is the intentional seam for pagination strategy.
  // Today we fetch one page per status and merge locally because Core only accepts
  // a single `status` filter.
  //
  // When Core supports multi-status queries, replace ONLY the batched fetch loop
  // below (statusesToFetch + Promise.all(taskService.listTasks per status)) with a
  // single request. Keep this function's public contract unchanged:
  //   input:  { columnId, cursor, limit, coworkersById, agentsById }
  //   output: { tasks, nextCursor }
  //
  // If the API cursor is sufficient, `decodeCursor`/`encodeCursor` can be removed
  // and `nextCursor` can forward the API cursor directly.
  const statuses = COLUMN_TASK_STATUSES[columnId];
  const state = normalizeState(statuses, decodeCursor(cursor));
  let mergedBuffer = dedupeAndSortTasks(state.buffer);

  while (mergedBuffer.length < limit) {
    const statusesToFetch = statuses.filter(
      (status) => !state.streams[status]?.exhausted,
    );
    if (statusesToFetch.length === 0) break;

    const remainingNeeded = limit - mergedBuffer.length;
    const perStatusLimit = Math.max(
      1,
      Math.ceil(remainingNeeded / statusesToFetch.length),
    );

    const pages = await Promise.all(
      statusesToFetch.map(async (status) => {
        const previousCursor = state.streams[status]?.cursor ?? null;
        const result = await taskService.listTasks({
          status,
          cursor: previousCursor,
          limit: perStatusLimit,
        });

        const tasks = result.tasks.map((task) =>
          mapTaskToTaskWithCoworker(task, coworkersById, agentsById),
        );

        return {
          status,
          tasks,
          previousCursor,
          nextCursor: result.pagination?.nextCursor ?? null,
        };
      }),
    );

    let madeProgress = false;

    for (const page of pages) {
      const isStalledCursor =
        page.tasks.length === 0 &&
        page.nextCursor !== null &&
        page.nextCursor === page.previousCursor;
      const exhausted = page.nextCursor === null || isStalledCursor;
      state.streams[page.status] = {
        cursor: page.nextCursor,
        exhausted,
      };
      if (
        page.tasks.length > 0 ||
        page.nextCursor !== page.previousCursor ||
        exhausted
      ) {
        madeProgress = true;
      }
      mergedBuffer.push(...page.tasks);
    }

    mergedBuffer = dedupeAndSortTasks(mergedBuffer);
    if (!madeProgress) break;
  }

  const tasks = mergedBuffer.slice(0, limit);
  const remainingBuffer = mergedBuffer.slice(limit);
  state.buffer = remainingBuffer;

  const hasMore =
    remainingBuffer.length > 0 ||
    statuses.some((status) => !state.streams[status]?.exhausted);

  return {
    tasks,
    nextCursor: hasMore ? encodeCursor(state) : null,
  };
}

function normalizeState(
  statuses: TaskStatus[],
  candidate: ColumnPaginationState | null,
): ColumnPaginationState {
  const streams: Partial<Record<TaskStatus, ColumnStreamState>> = {};

  for (const status of statuses) {
    const streamState = toValidStreamState(candidate?.streams?.[status]);
    streams[status] = streamState ?? {
      cursor: null,
      exhausted: false,
    };
  }

  const allowedStatuses = new Set(statuses);
  const buffer = (candidate?.buffer ?? []).filter(
    (task): task is TaskWithCoworker =>
      isTaskWithCoworkerLike(task) && allowedStatuses.has(task.status),
  );

  return {
    version: CURSOR_STATE_VERSION,
    streams,
    buffer: buffer.slice(0, MAX_CURSOR_BUFFER_SIZE),
  };
}

function toValidStreamState(value: unknown): ColumnStreamState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    cursor?: unknown;
    exhausted?: unknown;
  };
  if (
    !(candidate.cursor === null || typeof candidate.cursor === "string") ||
    typeof candidate.exhausted !== "boolean"
  ) {
    return null;
  }

  return {
    cursor: candidate.cursor,
    exhausted: candidate.exhausted,
  };
}

function isTaskWithCoworkerLike(value: unknown): value is TaskWithCoworker {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TaskWithCoworker>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.commentsCount === "number" &&
    typeof candidate.columnId === "string" &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.agents) &&
    Object.values(TaskStatus).includes(candidate.status as TaskStatus)
  );
}

function dedupeAndSortTasks(tasks: TaskWithCoworker[]): TaskWithCoworker[] {
  const sortedTasks = [...tasks].sort(compareTasksDesc);
  const uniqueTasks: TaskWithCoworker[] = [];
  const seenIds = new Set<string>();

  for (const task of sortedTasks) {
    if (seenIds.has(task.id)) continue;
    seenIds.add(task.id);
    uniqueTasks.push(task);
  }

  return uniqueTasks;
}

function decodeCursor(cursor: ColumnCursor): ColumnPaginationState | null {
  if (!cursor) return null;
  if (cursor.length > MAX_CURSOR_PAYLOAD_BYTES * 2) return null;

  const separatorIndex = cursor.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === cursor.length - 1) {
    // Legacy/invalid unsigned cursor: fall back to initial state.
    return null;
  }

  try {
    const payload = cursor.slice(0, separatorIndex);
    const signature = cursor.slice(separatorIndex + 1);
    if (!isValidPayloadSignature(payload, signature)) return null;

    const decodedPayload = Buffer.from(payload, "base64url");
    if (decodedPayload.byteLength > MAX_CURSOR_PAYLOAD_BYTES) return null;

    const parsed = JSON.parse(
      decodedPayload.toString("utf8"),
    ) as Partial<ColumnPaginationState> | null;

    if (parsed?.version !== CURSOR_STATE_VERSION) return null;
    if (!parsed.streams || typeof parsed.streams !== "object") return null;
    if (!Array.isArray(parsed.buffer)) return null;
    if (parsed.buffer.length > MAX_CURSOR_BUFFER_SIZE) return null;

    return {
      version: CURSOR_STATE_VERSION,
      streams: parsed.streams,
      buffer: parsed.buffer,
    };
  } catch {
    return null;
  }
}

function encodeCursor(state: ColumnPaginationState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString(
    "base64url",
  );
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

function signPayload(payload: string): string {
  return createHmac("sha256", getCursorSigningSecret())
    .update(payload, "utf8")
    .digest("base64url");
}

function isValidPayloadSignature(payload: string, signature: string): boolean {
  const expectedSignature = signPayload(payload);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

let cachedCursorSigningSecret: string | null = null;

function getCursorSigningSecret(): string {
  if (cachedCursorSigningSecret) return cachedCursorSigningSecret;

  cachedCursorSigningSecret = getEnvSecrets().BETTER_AUTH_SECRET;

  return cachedCursorSigningSecret;
}
