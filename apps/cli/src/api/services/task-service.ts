import type { CoreHttpClient } from "../http-client.js";
import { type AgentJob, parseAgentJob } from "../models/agent-job.js";
import { type ApiResponse, parseApiResponse } from "../models/api-response.js";
import { parseTask, type Task } from "../models/task.js";

const TASKS_PATH = "/v1/tasks";

export interface FetchTasksOptions {
  q?: string;
  status?: string | readonly string[];
  statuses?: string | readonly string[];
  scope?: string;
  coworkerId?: string;
  cursor?: string;
  take?: number | string;
  skip?: number | string;
}

export interface CreateTaskData {
  name?: string;
  description?: string | null;
  projectId?: string | null;
  coworkerId?: string | null;
  assigneeId?: string | null;
  assigneeSokoBotId?: string | null;
  assigneeUserId?: string | null;
  status?: string;
  channel?: string;
  origin?: string;
  context?: Record<string, unknown>;
}

export interface AddJobToTaskData {
  agentId?: string;
  inputSchema?: unknown;
  inputData?: Record<string, unknown>;
  maxCredits?: number;
  name?: string;
}

export interface CreateTaskEventData {
  status?: string;
  comment?: string;
  authenticationUrl?: string;
  credits?: number | null;
  channel?: string;
  origin?: string;
  masumiPayment?: Record<string, unknown>;
}

function requireId(id: string, name: string): void {
  if (!id) throw new Error(`${name} is required`);
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
    params.set("coworkerId", String(options.coworkerId).trim());
  if (options.cursor) params.set("cursor", String(options.cursor).trim());
  if (options.take !== undefined) params.set("take", String(options.take));
  if (options.skip !== undefined) params.set("skip", String(options.skip));
  for (const status of values(options.statuses ?? options.status))
    params.append("status", status);
  const query = params.toString();
  return query ? `${TASKS_PATH}?${query}` : TASKS_PATH;
}

function listResponse(parsed: ApiResponse<unknown>): ApiResponse<unknown[]> {
  return { ...parsed, data: Array.isArray(parsed.data) ? parsed.data : [] };
}

export async function createTask(
  client: CoreHttpClient,
  data: CreateTaskData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; task: Task }> {
  const payload = { ...data };
  if (typeof payload.name === "string") payload.name = payload.name.trim();
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

export async function addJobToTask(
  client: CoreHttpClient,
  taskId: string,
  data: AddJobToTaskData = {},
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown>; job: unknown }> {
  requireId(taskId, "taskId");
  if (!data.agentId) throw new Error("agentId is required");
  if (!data.inputSchema) throw new Error("inputSchema is required");
  const payload = { ...data, inputData: data.inputData ?? {} };
  if (typeof payload.name === "string")
    payload.name = payload.name.trim() || undefined;
  const response = parseApiResponse(
    await client.post<unknown>(
      `${TASKS_PATH}/${encodeURIComponent(taskId)}/jobs`,
      payload,
      signal,
    ),
  );
  return { response, job: response.data };
}

export async function fetchTaskEvents(
  client: CoreHttpClient,
  taskId: string,
  signal?: AbortSignal,
): Promise<{ response: ApiResponse<unknown[]>; events: unknown[] }> {
  requireId(taskId, "taskId");
  const response = listResponse(
    parseApiResponse(
      await client.get<unknown>(
        `${TASKS_PATH}/${encodeURIComponent(taskId)}/events`,
        signal,
      ),
    ),
  );
  return { response, events: response.data };
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
