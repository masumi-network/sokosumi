import { readFile } from "node:fs/promises";
import {
  fetchPersonalWorkspaceAccess,
  verifyPersonalWorkspace,
} from "../../api/services/personal-workspace-service.js";
import {
  createTask,
  createTaskEvent,
  createTaskLink,
  fetchTask,
  fetchTaskEvents,
  fetchTaskJobs,
  fetchTaskLinks,
  fetchTasks,
  resolveTaskId,
  type TaskFields,
  updateTask,
} from "../../api/services/task-service.js";
import { fetchUserIdentity } from "../../api/services/user-identity-service.js";
import {
  type CommandContext,
  type CommandOptions,
  formatDate,
  option,
  optionBoolean,
  optionString,
  parsePositiveInteger,
  record,
  truncate,
  validateChoice,
  writeJson,
  writeText,
} from "./command-helpers.js";

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;
const LINK_RELATIONS = [
  "related",
  "blocks",
  "blocked_by",
  "parent",
  "child",
  "duplicate",
] as const;

const TASK_ID_COMMANDS = [
  "get",
  "events",
  "jobs",
  "comment",
  "update",
  "links",
  "link",
];

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
    value.identifier ? `identifier: ${String(value.identifier)}` : undefined,
    `status: ${String(value.status || "unknown")}`,
    value.priority ? `priority: ${String(value.priority)}` : undefined,
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

function printLinks(
  stdout: CommandContext["stdout"],
  links: readonly unknown[],
): void {
  if (!links.length) return writeText(stdout, ["No links found."]);
  const lines = ["Links"];
  for (const raw of links) {
    const link = record(raw);
    const peer = record(link.peerTask);
    lines.push(
      `${String(link.relation || "-")} ${String(peer.identifier || peer.id || "-")} ${String(peer.name || "")}`.trim(),
    );
    if (link.note) lines.push(`  ${truncate(link.note, 220)}`);
  }
  writeText(stdout, lines);
}

async function readDescription(
  options: CommandOptions | undefined,
): Promise<string | undefined> {
  const text = optionString(options, "description");
  const file = optionString(options, "description-file");
  if (text !== undefined && file !== undefined)
    throw new Error(
      "Pass either --description or --description-file, not both",
    );
  return file === undefined ? text : readFile(file, "utf8");
}

/** Fields shared by `tasks create` and `tasks update`. */
async function readTaskFields(
  options: CommandOptions | undefined,
): Promise<TaskFields> {
  const coworkerId = optionString(options, "coworker-id");
  const assigneeUserId = optionString(options, "assignee-user-id");
  if (coworkerId !== undefined && assigneeUserId !== undefined)
    throw new Error(
      "Pass either --coworker-id or --assignee-user-id, not both",
    );
  return {
    name: optionString(options, "name"),
    description: await readDescription(options),
    coworkerId,
    assigneeUserId,
    projectId: optionString(options, "project-id"),
    priority: validateChoice(
      option(options, "priority"),
      PRIORITIES,
      "--priority",
    ),
  };
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
        q: optionString(options, "search"),
        status: optionString(options, "status"),
        scope: optionString(options, "scope"),
        coworkerId: optionString(options, "coworker-id"),
        take: limit,
      },
      signal,
    );
    const listed = limit === undefined ? tasks : tasks.slice(0, limit);
    if (json) writeJson(stdout, { tasks: listed });
    else printTaskList(stdout, listed);
    return;
  }
  if (command === "create") {
    const fields = await readTaskFields(options);
    if (!fields.description)
      throw new Error(
        "--description or --description-file is required for `tasks create`",
      );
    const personal = optionBoolean(options, "personal");
    if (
      personal &&
      (option(options, "organization-slug") !== undefined ||
        option(options, "organization-id") !== undefined ||
        option(options, "workspace-id") !== undefined)
    )
      throw new Error(
        "--personal cannot be combined with organization or Workspace flags",
      );
    const personalUser = personal
      ? await fetchUserIdentity(client, signal)
      : undefined;
    if (personal && !(await fetchPersonalWorkspaceAccess(client, signal)))
      throw new Error(
        "Personal Workspace is missing. Use coworkers register --personal or connect --personal first.",
      );
    const { task, response } = await createTask(
      client,
      {
        ...fields,
        status: validateChoice(
          option(options, "status"),
          ["DRAFT", "READY"],
          "--status",
        ),
      },
      signal,
    );
    if (
      personalUser &&
      (record(response.data).ownerId !== personalUser.id ||
        record(response.data).organizationId !== null ||
        record(record(response.data).workspace).organizationId !== null)
    )
      throw new Error(
        `Task ${task.id ?? "(ID unavailable)"} creation did not confirm your personal Workspace. Creation may have succeeded. Inspect this Task before retrying.`,
      );
    if (personalUser) {
      try {
        await verifyPersonalWorkspace(
          client,
          String(record(record(response.data).workspace).id ?? ""),
          signal,
        );
      } catch {
        throw new Error(
          `Task ${task.id ?? "(ID unavailable)"} was created, but personal Workspace ownership could not be confirmed. Inspect this Task before retrying.`,
        );
      }
    }
    const id = record(task).id;
    const details =
      typeof id === "string" && id
        ? await collectTaskDetails(client, id, signal)
        : {};
    if (json) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  if (!TASK_ID_COMMANDS.includes(command))
    throw new Error(`Unknown tasks subcommand: ${command}`);
  const ref = positionalId || optionString(options, "id");
  if (!ref) throw new Error(`task id is required for \`tasks ${command}\``);
  if (command === "get") {
    const { task } = await fetchTask(client, ref, signal);
    const details = task.id
      ? await collectTaskDetails(client, task.id, signal)
      : {};
    if (json) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  if (command === "events") {
    const id = await resolveTaskId(client, ref, signal);
    const { events } = await fetchTaskEvents(client, id, signal);
    if (json) writeJson(stdout, { events });
    else printEvents(stdout, events);
    return;
  }
  if (command === "jobs") {
    const id = await resolveTaskId(client, ref, signal);
    const { jobs } = await fetchTaskJobs(client, id, signal);
    if (json) writeJson(stdout, { jobs });
    else printJobList(stdout, jobs);
    return;
  }
  if (command === "comment") {
    const comment = optionString(options, "comment");
    const status = optionString(options, "status");
    if (!comment && !status)
      throw new Error("--comment or --status is required for `tasks comment`");
    const id = await resolveTaskId(client, ref, signal);
    const { event } = await createTaskEvent(
      client,
      id,
      { comment, status },
      signal,
    );
    if (json) writeJson(stdout, { event });
    else
      writeText(stdout, [
        `Created task event ${String(record(event).id || "")}`.trim(),
        status ? `status: ${status}` : undefined,
        comment ? `comment: ${truncate(comment, 220)}` : undefined,
      ]);
    return;
  }
  if (command === "update") {
    const fields = await readTaskFields(options);
    if (Object.values(fields).every((value) => value === undefined))
      throw new Error(
        "Pass at least one of --name, --description, --description-file, --priority, --project-id, --coworker-id, or --assignee-user-id",
      );
    const id = await resolveTaskId(client, ref, signal);
    const { task } = await updateTask(client, id, fields, signal);
    if (json) writeJson(stdout, { task });
    else printTask(stdout, task, {});
    return;
  }
  if (command === "links") {
    const id = await resolveTaskId(client, ref, signal);
    const { links } = await fetchTaskLinks(client, id, signal);
    if (json) writeJson(stdout, { links });
    else printLinks(stdout, links);
    return;
  }
  if (command === "link") {
    const to = optionString(options, "to");
    if (!to) throw new Error("--to is required for `tasks link`");
    const relation = validateChoice(
      option(options, "relation"),
      LINK_RELATIONS,
      "--relation",
    );
    if (!relation)
      throw new Error(
        `--relation must be one of: ${LINK_RELATIONS.join(", ")}`,
      );
    const { link } = await createTaskLink(
      client,
      await resolveTaskId(client, ref, signal),
      {
        toTaskId: await resolveTaskId(client, to, signal),
        relation,
        note: optionString(options, "note"),
      },
      signal,
    );
    if (json) writeJson(stdout, { link });
    else printLinks(stdout, [link]);
    return;
  }
  throw new Error(`Unknown tasks subcommand: ${command}`);
}
