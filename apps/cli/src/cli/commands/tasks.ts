import {
  createTask,
  createTaskEvent,
  fetchTask,
  fetchTaskEvents,
  fetchTaskJobs,
  fetchTasks,
} from "../../api/services/task-service.js";
import {
  applyListFilters,
  type CommandContext,
  type CommandOptions,
  formatDate,
  isJson,
  option,
  optionString,
  parsePositiveInteger,
  record,
  truncate,
  validateStatus,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface TasksCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

function printTaskList(
  stdout: CommandContext["stdout"],
  tasks: readonly unknown[],
): void {
  if (!tasks.length) return writeText(stdout, ["No tasks found."]);
  const lines = ["Tasks"];
  for (const raw of tasks) {
    const task = record(raw);
    lines.push(
      `${String(task.name || task.id || "Unnamed Task")} [${String(task.id || "unknown")}]`,
    );
    lines.push(
      `  status: ${String(task.status || "unknown")} | coworker: ${String(task.coworkerName || task.coworkerId || "-")}`,
    );
    if (task.updatedAt)
      lines.push(`  updated: ${formatDate(task.updatedAt) || ""}`);
  }
  writeText(stdout, lines);
}
function printJobList(
  stdout: CommandContext["stdout"],
  jobs: readonly unknown[],
): void {
  if (!jobs.length) return writeText(stdout, ["No jobs found."]);
  const lines = ["Jobs"];
  for (const raw of jobs) {
    const job = record(raw);
    lines.push(
      `${String(job.name || job.id || "Unnamed Job")} [${String(job.id || "unknown")}]`,
    );
    lines.push(
      `  status: ${String(job.status || "unknown")} | agent: ${String(job.agentId || "-")}`,
    );
  }
  writeText(stdout, lines);
}

function printTask(
  stdout: CommandContext["stdout"],
  task: unknown,
  details: Record<string, unknown>,
): void {
  const value = record(task);
  const events = Array.isArray(details.events) ? details.events : [];
  writeText(stdout, [
    `Task ${String(value.id || "unknown")}`,
    `status: ${String(value.status || "unknown")}`,
    `coworker: ${String(value.coworkerName || value.coworkerId || "-")}`,
    value.name ? `name: ${String(value.name)}` : undefined,
    value.description
      ? `description: ${truncate(value.description, 240)}`
      : undefined,
    value.totalCredits != null
      ? `credits: ${String(value.totalCredits)}`
      : undefined,
    Array.isArray(details.jobs) ? `jobs: ${details.jobs.length}` : undefined,
    Array.isArray(details.events)
      ? `events: ${details.events.length}`
      : undefined,
    events.length
      ? `latest event: ${truncate(record(events.at(-1)).comment || record(events.at(-1)).message || record(events.at(-1)).status || record(events.at(-1)).id, 160)}`
      : undefined,
    Array.isArray(details.detailsErrors) && details.detailsErrors.length
      ? `detail errors: ${details.detailsErrors.map((item) => String(record(item).resource)).join(", ")}`
      : undefined,
  ]);
}

function printEvents(
  stdout: CommandContext["stdout"],
  events: readonly unknown[],
): void {
  if (!events.length) return writeText(stdout, ["No events found."]);
  const lines = ["Events"];
  for (const raw of events) {
    const event = record(raw);
    lines.push(String(event.id || "(event)"));
    if (event.createdAt)
      lines.push(`  created: ${formatDate(event.createdAt) || ""}`);
    if (event.status) lines.push(`  status: ${String(event.status)}`);
    if (event.type) lines.push(`  type: ${String(event.type)}`);
    if (event.comment || event.message)
      lines.push(`  ${truncate(event.comment || event.message, 220)}`);
  }
  writeText(stdout, lines);
}

async function collectTaskDetails(
  client: CommandContext["client"],
  taskId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const [eventsResult, jobsResult] = await Promise.allSettled([
    fetchTaskEvents(client, taskId, signal),
    fetchTaskJobs(client, taskId, signal),
  ]);
  const details: Record<string, unknown> = {};
  const errors: Record<string, string>[] = [];
  if (eventsResult.status === "fulfilled")
    details.events = eventsResult.value.events;
  else
    errors.push({
      resource: "events",
      message:
        eventsResult.reason instanceof Error
          ? eventsResult.reason.message
          : "fetch failed",
    });
  if (jobsResult.status === "fulfilled") details.jobs = jobsResult.value.jobs;
  else
    errors.push({
      resource: "jobs",
      message:
        jobsResult.reason instanceof Error
          ? jobsResult.reason.message
          : "fetch failed",
    });
  if (errors.length) details.detailsErrors = errors;
  return details;
}

export async function runTasksCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
  positionalId,
  options,
}: TasksCommandContext): Promise<void> {
  const command = subcommand || "list";
  if (command === "list") {
    const limit = parsePositiveInteger(option(options, "limit"), "--limit");
    const { tasks } = await fetchTasks(
      client,
      {
        q: optionString(options, "search", "q"),
        status: optionString(options, "status"),
        scope: optionString(options, "scope"),
        coworkerId: optionString(options, "coworker-id"),
        take: limit,
      },
      signal,
    );
    const filtered = applyListFilters(tasks, {
      search: option(options, "search", "q"),
      limit,
      fields: (item) => {
        const value = record(item);
        return [
          value.id,
          value.name,
          value.description,
          value.status,
          value.coworkerId,
          value.coworkerName,
        ];
      },
    });
    if (isJson({ json })) writeJson(stdout, { tasks: filtered });
    else printTaskList(stdout, filtered);
    return;
  }
  if (command === "create") {
    const coworkerId = optionString(options, "coworker-id");
    const description = optionString(options, "description", "desc");
    if (!coworkerId)
      throw new Error("--coworker-id is required for `tasks create`");
    if (!description)
      throw new Error("--description is required for `tasks create`");
    const { task } = await createTask(
      client,
      {
        coworkerId,
        description,
        name: optionString(options, "name"),
        status: validateStatus(option(options, "status"), ["DRAFT", "READY"]),
      },
      signal,
    );
    const id = record(task).id;
    const details =
      typeof id === "string" && id
        ? await collectTaskDetails(client, id, signal)
        : {};
    if (isJson({ json })) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  const id = positionalId || optionString(options, "id", "task-id");
  if (command === "get") {
    if (!id) throw new Error("task id is required for `tasks get`");
    const { task } = await fetchTask(client, id, signal);
    const details = await collectTaskDetails(client, id, signal);
    if (isJson({ json })) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  if (command === "events") {
    if (!id) throw new Error("task id is required for `tasks events`");
    const { events } = await fetchTaskEvents(client, id, signal);
    if (isJson({ json })) writeJson(stdout, { events });
    else printEvents(stdout, events);
    return;
  }
  if (command === "jobs") {
    if (!id) throw new Error("task id is required for `tasks jobs`");
    const { jobs } = await fetchTaskJobs(client, id, signal);
    if (isJson({ json })) writeJson(stdout, { jobs });
    else printJobList(stdout, jobs);
    return;
  }
  if (command === "comment") {
    if (!id) throw new Error("task id is required for `tasks comment`");
    const comment = optionString(options, "comment");
    const status = optionString(options, "status");
    if (!comment && !status)
      throw new Error("--comment or --status is required for `tasks comment`");
    const { event } = await createTaskEvent(
      client,
      id,
      { comment, status },
      signal,
    );
    if (isJson({ json })) writeJson(stdout, { event });
    else
      writeText(stdout, [
        `Created task event ${String(record(event).id || "")}`.trim(),
        status ? `status: ${status}` : undefined,
        comment ? `comment: ${truncate(comment, 220)}` : undefined,
      ]);
    return;
  }
  throw new Error(`Unknown tasks subcommand: ${command}`);
}
