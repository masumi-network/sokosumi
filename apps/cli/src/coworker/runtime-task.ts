import type { CoreHttpClient } from "../api/http-client.js";

export interface RuntimeTask {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  assigneeId: string;
  status: string;
}

interface TaskContext {
  client: CoreHttpClient;
  coworkerId: string;
  organizationId: string;
  taskId: string;
  signal?: AbortSignal;
}

interface CompletedRuntimeTask {
  taskId: string;
  eventId: string;
  status: "COMPLETED";
  result: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error(
      "Runtime operation was aborted. Inspect the Task before retrying.",
    );
  }
}

async function request(
  operation: string,
  call: () => Promise<unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  checkAbort(signal);
  let response: unknown;
  try {
    response = await call();
  } catch (error) {
    const status = record(error)?.status;
    const code =
      Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599
        ? ` (HTTP ${status})`
        : "";
    const insufficientBalance =
      status === 422 &&
      record(record(error)?.body)?.kind === "insufficient_balance";
    throw new Error(
      `${operation} failed${code}. ${insufficientBalance ? "The Task has insufficient credits and may be paused. " : ""}Inspect the Task before retrying.`,
    );
  }
  checkAbort(signal);
  const data = record(record(response)?.data);
  if (!data)
    throw new Error(
      `${operation} returned an invalid response. Inspect the Task before retrying.`,
    );
  return data;
}

async function verifyCoworker(context: TaskContext): Promise<void> {
  if (
    ![context.coworkerId, context.organizationId, context.taskId].every(
      nonempty,
    )
  ) {
    throw new Error("Coworker, organization, and Task IDs are required.");
  }
  const coworker = await request(
    "Coworker identity check",
    () => context.client.get("/v1/coworkers/me", context.signal),
    context.signal,
  );
  if (
    coworker.id !== context.coworkerId ||
    coworker.archivedAt !== null ||
    !Array.isArray(coworker.capabilities) ||
    !coworker.capabilities.every(
      (capability) => typeof capability === "string",
    ) ||
    !coworker.capabilities.includes("tasks")
  ) {
    throw new Error(
      "Runtime identity must match the active Coworker with Task capability.",
    );
  }
}

function taskPath(context: TaskContext): string {
  return `/v1/tasks/${encodeURIComponent(context.taskId)}`;
}

async function readTask(
  context: TaskContext,
  status: string,
): Promise<RuntimeTask> {
  const task = await request(
    "Task read",
    () => context.client.get(taskPath(context), context.signal),
    context.signal,
  );
  if (
    task.id !== context.taskId ||
    !nonempty(task.name) ||
    !(task.description === null || typeof task.description === "string") ||
    task.assigneeId !== context.coworkerId ||
    task.organizationId !== context.organizationId ||
    (task.workspace !== undefined &&
      record(task.workspace)?.organizationId !== context.organizationId) ||
    (task.assignee !== undefined &&
      (record(task.assignee)?.type !== "coworker" ||
        record(task.assignee)?.id !== context.coworkerId))
  ) {
    throw new Error(
      "Task response does not match the requested Task, Coworker, and organization.",
    );
  }
  if (task.status !== status) {
    throw new Error(
      `Task must be ${status}. No further operation was submitted.`,
    );
  }
  return {
    id: context.taskId,
    name: task.name,
    description: task.description,
    organizationId: context.organizationId,
    assigneeId: context.coworkerId,
    status,
  };
}

function eventId(
  event: Record<string, unknown>,
  context: TaskContext,
  status: string | null,
): string {
  if (
    !nonempty(event.id) ||
    event.taskId !== context.taskId ||
    event.status !== status ||
    (event.actor !== undefined &&
      (record(event.actor)?.type !== "coworker" ||
        record(event.actor)?.id !== context.coworkerId))
  ) {
    throw new Error(
      "Task event could not be confirmed. Inspect the Task before retrying.",
    );
  }
  return event.id;
}

async function postEvent(
  context: TaskContext,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return request(
    "Task event submission",
    () =>
      context.client.post(`${taskPath(context)}/events`, body, context.signal),
    context.signal,
  );
}

export async function startRuntimeTask(
  options: TaskContext,
): Promise<RuntimeTask> {
  await verifyCoworker(options);
  const task = await readTask(options, "READY");
  eventId(await postEvent(options, { status: "RUNNING" }), options, "RUNNING");
  return { ...task, status: "RUNNING" };
}

function requireResult(result: string): void {
  if (!nonempty(result)) {
    throw new Error("Runtime returned no result. No completion was submitted.");
  }
}

async function completeVerifiedTask(
  options: TaskContext,
  result: string,
): Promise<CompletedRuntimeTask> {
  await readTask(options, "RUNNING");
  const completed = await postEvent(options, {
    status: "COMPLETED",
    comment: result,
  });
  return {
    taskId: options.taskId,
    eventId: eventId(completed, options, "COMPLETED"),
    status: "COMPLETED",
    result,
  };
}

export async function completeRuntimeTask(
  options: TaskContext & { result: string },
): Promise<CompletedRuntimeTask> {
  requireResult(options.result);
  await verifyCoworker(options);
  return completeVerifiedTask(options, options.result);
}

export async function executeRuntimeTask(
  options: TaskContext & {
    execute: (task: RuntimeTask, signal?: AbortSignal) => Promise<string>;
  },
): Promise<CompletedRuntimeTask> {
  const task = await startRuntimeTask(options);
  let result: string;
  try {
    checkAbort(options.signal);
    result = await options.execute(task, options.signal);
  } catch {
    throw new Error(
      "Runtime execution failed. No completion was submitted. Inspect the Task before retrying.",
    );
  }
  checkAbort(options.signal);
  requireResult(result);
  return completeVerifiedTask(options, result);
}
