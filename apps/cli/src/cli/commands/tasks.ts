import {
  approveTaskPaymentQuote,
  createTaskPaymentQuote,
  fetchTaskPaymentQuote,
  revokeTaskPaymentQuote,
  type TaskPaymentQuote,
  validatePaymentCredits,
  validatePaymentDeadline,
  validatePaymentId,
} from "../../api/services/task-payment-service.js";
import {
  createTask,
  createTaskEvent,
  fetchTask,
  fetchTaskEvents,
  fetchTaskJobs,
  fetchTasks,
} from "../../api/services/task-service.js";
import {
  type CommandContext,
  type CommandOptions,
  formatDate,
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

const PAYMENT_COMMON_OPTIONS = new Set([
  "json",
  "preprod",
  "api-url",
  "auth-url",
  "client-id",
  "organization-slug",
]);
const QUOTE_OPTIONS = new Set([
  "request-id",
  "pay-by",
  "submit-result-by",
  "unlock-at",
  "dispute-unlock-at",
]);
const APPROVE_OPTIONS = new Set([
  "quote-id",
  "terms-hash",
  "max-credits",
  "confirm-payment",
]);

export function validateTaskPaymentCommand({
  subcommand,
  positionalId,
  options,
}: Pick<TasksCommandContext, "subcommand" | "positionalId" | "options">): void {
  validatePaymentId(positionalId ?? "", "Task ID");
  for (const name of Object.keys(options ?? {})) {
    if (
      !PAYMENT_COMMON_OPTIONS.has(name) &&
      !(subcommand === "payment-quote" && QUOTE_OPTIONS.has(name)) &&
      !(subcommand === "payment-approve" && APPROVE_OPTIONS.has(name)) &&
      !(
        (subcommand === "payment-status" || subcommand === "payment-revoke") &&
        name === "quote-id"
      )
    ) {
      throw new Error(
        `Option --${name} is not supported by this Task payment command`,
      );
    }
  }
  if (subcommand === "payment-quote") {
    const requestId = optionString(options, "request-id") ?? "";
    if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(requestId)) {
      throw new Error(
        "--request-id must contain 1 to 200 letters, numbers, colons, underscores, or hyphens",
      );
    }
    for (const name of [
      "pay-by",
      "submit-result-by",
      "unlock-at",
      "dispute-unlock-at",
    ]) {
      validatePaymentDeadline(optionString(options, name) ?? "", `--${name}`);
    }
    return;
  }
  validatePaymentId(optionString(options, "quote-id") ?? "", "--quote-id");
  if (subcommand === "payment-approve") {
    if (options?.["confirm-payment"] !== true) {
      throw new Error(
        "Review tasks payment-status first. Payment approval requires --confirm-payment.",
      );
    }
    if (!/^[0-9a-f]{64}$/u.test(optionString(options, "terms-hash") ?? "")) {
      throw new Error(
        "--terms-hash must be the exact 64-character lowercase hash from the reviewed quote",
      );
    }
    const ceiling = optionString(options, "max-credits") ?? "";
    if (!/^\d+(?:\.\d+)?$/u.test(ceiling))
      throw new Error("--max-credits must be a positive decimal number");
    validatePaymentCredits(Number(ceiling));
  }
}

function printPaymentQuote(
  stdout: CommandContext["stdout"],
  quote: TaskPaymentQuote,
): void {
  const terms = quote.terms;
  writeText(stdout, [
    `Task payment quote ${quote.id}`,
    `Task: ${quote.taskId} | Coworker: ${quote.coworkerId}`,
    `State: ${quote.state} | Network: ${quote.network}`,
    `Billing owner: ${quote.billingOwnerId}`,
    `Billing organization: ${quote.billingOrganizationId ?? "personal"}`,
    `Seller binding: ${quote.sellerBindingId}`,
    `Quoted credits: ${quote.quotedCredits ?? "unresolved"}`,
    `Approved ceiling: ${quote.maxCredits ?? "none"}`,
    `Terms hash: ${quote.termsHash ?? "unresolved"}`,
    `Input hash: ${quote.inputHash}`,
    `Expires at: ${quote.expiresAt}`,
    ...(terms
      ? [
          `MPS payment: ${terms.paymentId}`,
          `Blockchain identifier: ${terms.blockchainIdentifier}`,
          `Purchaser identifier: ${terms.identifierFromPurchaser}`,
          `Agent identifier: ${terms.agentIdentifier}`,
          `Seller verification key hash: ${terms.sellerVkey}`,
          `Contract: ${terms.smartContractAddress} (${terms.paymentSourceType})`,
          terms.supportedPaymentSourceIndex === undefined
            ? undefined
            : `Payment source index: ${terms.supportedPaymentSourceIndex}`,
          `Seller return address: ${terms.sellerReturnAddress ?? "not specified"}`,
          ...terms.Amounts.map(
            (amount) =>
              `Amount: ${amount.amount} ${amount.unit || "lovelace (ADA)"}`,
          ),
          `Pay by: ${new Date(Number(terms.payByTime)).toISOString()}`,
          `Submit result by: ${new Date(Number(terms.submitResultTime)).toISOString()}`,
          `Unlock at: ${new Date(Number(terms.unlockTime)).toISOString()}`,
          `Dispute unlock at: ${new Date(Number(terms.externalDisputeUnlockTime)).toISOString()}`,
        ]
      : []),
    "Payments are disabled. Approval does not fund or execute the Task.",
  ]);
}

async function runTaskPaymentCommand(
  context: TasksCommandContext,
): Promise<void> {
  validateTaskPaymentCommand(context);
  const { client, stdout, json, options, subcommand } = context;
  const taskId = context.positionalId ?? "";
  const quoteId = optionString(options, "quote-id") ?? "";
  const timeout = AbortSignal.timeout(30_000);
  const signal = context.signal
    ? AbortSignal.any([context.signal, timeout])
    : timeout;
  let quote: TaskPaymentQuote;
  if (subcommand === "payment-quote") {
    quote = await createTaskPaymentQuote(
      client,
      taskId,
      {
        idempotencyKey: optionString(options, "request-id") ?? "",
        payByTime: optionString(options, "pay-by") ?? "",
        submitResultTime: optionString(options, "submit-result-by") ?? "",
        unlockTime: optionString(options, "unlock-at") ?? "",
        externalDisputeUnlockTime:
          optionString(options, "dispute-unlock-at") ?? "",
      },
      signal,
    );
  } else if (subcommand === "payment-approve") {
    const termsHash = optionString(options, "terms-hash") ?? "";
    const maxCredits = Number(optionString(options, "max-credits"));
    const reviewed = await fetchTaskPaymentQuote(
      client,
      taskId,
      quoteId,
      signal,
    );
    if (
      (reviewed.state !== "quoted" && reviewed.state !== "approved") ||
      reviewed.termsHash !== termsHash ||
      reviewed.quotedCredits === null ||
      maxCredits < reviewed.quotedCredits
    ) {
      throw new Error(
        "Quote cannot be approved with these terms or credit ceiling. Review tasks payment-status again.",
      );
    }
    if (!json) printPaymentQuote(stdout, reviewed);
    quote = await approveTaskPaymentQuote(
      client,
      taskId,
      quoteId,
      termsHash,
      maxCredits,
      signal,
    );
  } else if (subcommand === "payment-revoke") {
    quote = await revokeTaskPaymentQuote(client, taskId, quoteId, signal);
  } else {
    quote = await fetchTaskPaymentQuote(client, taskId, quoteId, signal);
  }
  const recovery =
    quote.state === "unresolved"
      ? {
          ...(subcommand === "payment-quote"
            ? { requestId: optionString(options, "request-id") }
            : {}),
          message:
            "Quote unresolved. Retry tasks payment-quote with the same --request-id and deadlines for read-only recovery. Funding is not confirmed.",
        }
      : undefined;
  if (json) writeJson(stdout, { quote, ...(recovery ? { recovery } : {}) });
  else {
    if (subcommand === "payment-approve")
      writeText(stdout, ["Payment quote approved. Payments remain disabled."]);
    else printPaymentQuote(stdout, quote);
    if (recovery) writeText(stdout, [recovery.message]);
  }
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
  if (
    [
      "payment-quote",
      "payment-status",
      "payment-approve",
      "payment-revoke",
    ].includes(command)
  ) {
    await runTaskPaymentCommand({
      client,
      stdout,
      json,
      signal,
      subcommand: command,
      positionalId,
      options,
    });
    return;
  }
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
    const coworkerId = optionString(options, "coworker-id");
    const description = optionString(options, "description");
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
    if (json) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  const id = positionalId || optionString(options, "id");
  if (command === "get") {
    if (!id) throw new Error("task id is required for `tasks get`");
    const { task } = await fetchTask(client, id, signal);
    const details = await collectTaskDetails(client, id, signal);
    if (json) writeJson(stdout, { task, ...details });
    else printTask(stdout, task, details);
    return;
  }
  if (command === "events") {
    if (!id) throw new Error("task id is required for `tasks events`");
    const { events } = await fetchTaskEvents(client, id, signal);
    if (json) writeJson(stdout, { events });
    else printEvents(stdout, events);
    return;
  }
  if (command === "jobs") {
    if (!id) throw new Error("task id is required for `tasks jobs`");
    const { jobs } = await fetchTaskJobs(client, id, signal);
    if (json) writeJson(stdout, { jobs });
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
    if (json) writeJson(stdout, { event });
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
