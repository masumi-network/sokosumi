import type { CoreHttpClient } from "../http-client.js";
import { type AgentJob, parseAgentJob } from "../models/agent-job.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { listResponse, requireId } from "../models/parse-helpers.js";
import { parseTask, type Task } from "../models/task.js";

const TASKS_PATH = "/v1/tasks";

interface FetchTasksOptions {
  q?: string;
  status?: string | readonly string[];
  scope?: string;
  coworkerId?: string;
  take?: number | string;
}

export interface TaskFields {
  name?: string;
  description?: string | null;
  coworkerId?: string | null;
  assigneeUserId?: string;
  projectId?: string | null;
  priority?: string;
}

interface CreateTaskData extends TaskFields {
  status?: string;
}

interface CreateTaskLinkData {
  toTaskId: string;
  relation: string;
  note?: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CreateTaskEventData {
  status?: string;
  comment?: string;
}

function values(input: string | readonly string[] | undefined): string[] {
  if (typeof input === "string") {
    return input
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (Array.isArray(input)) {
    return input
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function tasksPath(options: FetchTasksOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q) params.set("q", String(options.q).trim());
  if (options.scope) params.set("scope", String(options.scope).trim());
  if (options.coworkerId)
    params.set("assigneeId", String(options.coworkerId).trim());
  if (options.take !== undefined) params.set("take", String(options.take));
  for (const status of values(options.status)) params.append("status", status);
  const query = params.toString();
  return query ? `${TASKS_PATH}?${query}` : TASKS_PATH;
}

function taskPayload(data: TaskFields): Record<string, unknown> {
  const { coworkerId, ...rest } = data;
  const payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );
  if (coworkerId !== undefined) payload.assigneeId = coworkerId;
  if (typeof payload.name === "string") payload.name = payload.name.trim();
  return payload;
}

export async function createTask(
  client: CoreHttpClient,
  data: CreateTaskData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; task: Task }> {
  const payload = taskPayload(data);
  const response = parseApiResponse(
    await client.post<unknown>(TASKS_PATH, payload, signal),
  );
  return { response, task: parseTask(response.data) };
}

export async function fetchTask(
  client: CoreHttpClient,
  taskId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; task: Task }> {
  requireId(taskId, "taskId");
  const response = parseApiResponse(
    await client.get<unknown>(
      `${TASKS_PATH}/${encodeURIComponent(taskId)}`,
      signal,
    ),
  );
  return { response, task: parseTask(response.data) };
}

/**
 * Core resolves short identifiers such as SOK-12 only on GET /v1/tasks/:id,
 * so other Task routes get the UUID from that lookup first.
 */
export async function resolveTaskId(
  client: CoreHttpClient,
  ref: string,
  signal?: AbortSignal,
): Promise<string> {
  requireId(ref, "taskId");
  if (UUID_PATTERN.test(ref)) return ref;
  const { task } = await fetchTask(client, ref, signal);
  if (!task.id) throw new Error(`Task ${ref} has no id in Core's response`);
  return task.id;
}

export async function updateTask(
  client: CoreHttpClient,
  taskId: string,
  data: TaskFields,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; task: Task }> {
  requireId(taskId, "taskId");
  const response = parseApiResponse(
    await client.patch<unknown>(
      `${TASKS_PATH}/${encodeURIComponent(taskId)}`,
      taskPayload(data),
      signal,
    ),
  );
  return { response, task: parseTask(response.data) };
}

export async function fetchTaskLinks(
  client: CoreHttpClient,
  taskId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; links: unknown[] }> {
  requireId(taskId, "taskId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${TASKS_PATH}/${encodeURIComponent(taskId)}/links`,
        signal,
      ),
    ),
  );
  return { response, links: response.data };
}

export async function createTaskLink(
  client: CoreHttpClient,
  taskId: string,
  data: CreateTaskLinkData,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; link: unknown }> {
  requireId(taskId, "taskId");
  const response = parseApiResponse(
    await client.post<unknown>(
      `${TASKS_PATH}/${encodeURIComponent(taskId)}/links`,
      data,
      signal,
    ),
  );
  return { response, link: response.data };
}

export async function fetchTasks(
  client: CoreHttpClient,
  options: FetchTasksOptions = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; tasks: Task[] }> {
  const response = listResponse(
    parseApiResponse(await client.get<unknown>(tasksPath(options), signal)),
  );
  return { response, tasks: response.data.map(parseTask) };
}

export async function fetchTaskJobs(
  client: CoreHttpClient,
  taskId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; jobs: AgentJob[] }> {
  requireId(taskId, "taskId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${TASKS_PATH}/${encodeURIComponent(taskId)}/jobs`,
        signal,
      ),
    ),
  );
  return { response, jobs: response.data.map(parseAgentJob) };
}

export async function fetchTaskEvents(
  client: CoreHttpClient,
  taskId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; events: unknown[] }> {
  requireId(taskId, "taskId");

  const events: unknown[] = [];
  let cursor: string | undefined;
  let lastResponse: ApiResponse<unknown[]> | undefined;

  for (;;) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const path = `${TASKS_PATH}/${encodeURIComponent(taskId)}/events?${params}`;
    const response = listResponse(
      parseApiResponse(await client.get<unknown>(path, signal)),
    );
    lastResponse = response;
    events.push(...response.data);

    const pagination =
      response.meta?.pagination &&
      typeof response.meta.pagination === "object" &&
      !Array.isArray(response.meta.pagination)
        ? (response.meta.pagination as Record<string, unknown>)
        : null;
    const next =
      typeof pagination?.nextCursor === "string" && pagination.nextCursor
        ? pagination.nextCursor
        : null;
    if (!next || next === cursor) break;
    cursor = next;
  }

  return {
    response: { ...(lastResponse ?? { data: [] }), data: events },
    events,
  };
}

export async function createTaskEvent(
  client: CoreHttpClient,
  taskId: string,
  data: CreateTaskEventData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; event: unknown }> {
  requireId(taskId, "taskId");
  const payload = { ...data };
  if (typeof payload.comment === "string")
    payload.comment = payload.comment.trim();
  const response = parseApiResponse(
    await client.post<unknown>(
      `${TASKS_PATH}/${encodeURIComponent(taskId)}/events`,
      payload,
      signal,
    ),
  );
  return { response, event: response.data };
}
