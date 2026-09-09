import {
  fetchJob,
  fetchJobEvents,
  fetchJobFiles,
  fetchJobInputRequest,
  fetchJobLinks,
  fetchJobs,
  submitJobInput,
} from "../../api/services/job-service.js";
import {
  applyListFilters,
  type CommandContext,
  type CommandOptions,
  isJson,
  option,
  optionString,
  parsePositiveInteger,
  readJsonObject,
  record,
  truncate,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface JobsCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
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
    if (job.result) lines.push(`  result: ${truncate(job.result, 160)}`);
  }
  writeText(stdout, lines);
}

function printJob(
  stdout: CommandContext["stdout"],
  job: unknown,
  details: Record<string, unknown>,
): void {
  const value = record(job);
  const lines: (string | undefined)[] = [
    `Job ${String(value.id || "unknown")}`,
    `status: ${String(value.status || "unknown")}`,
    `agent: ${String(value.agentId || "-")}`,
    value.name ? `name: ${String(value.name)}` : undefined,
    value.credits != null ? `credits: ${String(value.credits)}` : undefined,
    value.result ? `result: ${String(value.result)}` : undefined,
    value.output ? `output: ${String(value.output)}` : undefined,
  ];
  if (details.inputRequest) lines.push("input request: pending");
  const events = Array.isArray(details.events) ? details.events : [];
  if (events.length) {
    const latestEvent = record(events[0]);
    lines.push(
      `events: ${events.length}`,
      `latest event: ${truncate(latestEvent.result || latestEvent.message || latestEvent.status || latestEvent.type || latestEvent.id, 160)}`,
    );
  }
  const files = Array.isArray(details.files) ? details.files : [];
  if (files.length) {
    lines.push(`files: ${files.length}`);
    for (const raw of files.slice(0, 3)) {
      const file = record(raw);
      lines.push(
        `  ${String(file.name || file.id || "file")}: ${String(file.url || "-")}`,
      );
    }
  }
  const links = Array.isArray(details.links) ? details.links : [];
  if (links.length) {
    lines.push(`links: ${links.length}`);
    for (const raw of links.slice(0, 3)) {
      const link = record(raw);
      lines.push(
        `  ${String(link.title || link.id || "link")}: ${String(link.url || "-")}`,
      );
    }
  }
  if (Array.isArray(details.detailsErrors) && details.detailsErrors.length)
    lines.push(
      `detail errors: ${details.detailsErrors.map((item) => String(record(item).resource)).join(", ")}`,
    );
  writeText(stdout, lines);
}

async function collectJobDetails(
  client: CommandContext["client"],
  id: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const results = await Promise.allSettled([
    fetchJobEvents(client, id, signal),
    fetchJobFiles(client, id, signal),
    fetchJobLinks(client, id, signal),
    fetchJobInputRequest(client, id, signal),
  ]);
  const details: Record<string, unknown> = {};
  const errors: Record<string, string>[] = [];
  const [events, files, links, inputRequest] = results;
  if (events.status === "fulfilled") details.events = events.value.events;
  else errors.push({ resource: "events", message: "fetch failed" });
  if (files.status === "fulfilled") details.files = files.value.files;
  else errors.push({ resource: "files", message: "fetch failed" });
  if (links.status === "fulfilled") details.links = links.value.links;
  else errors.push({ resource: "links", message: "fetch failed" });
  if (inputRequest.status === "fulfilled")
    details.inputRequest = inputRequest.value.inputRequest;
  else errors.push({ resource: "inputRequest", message: "fetch failed" });
  if (errors.length) details.detailsErrors = errors;
  return details;
}

export async function runJobsCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
  positionalId,
  options,
}: JobsCommandContext): Promise<void> {
  const command = subcommand || "list";
  if (command === "list") {
    const limit = parsePositiveInteger(option(options, "limit"), "--limit");
    const { jobs } = await fetchJobs(client, signal);
    const filtered = applyListFilters(jobs, {
      search: option(options, "search"),
      limit,
      fields: (item) => {
        const value = record(item);
        return [value.id, value.name, value.status, value.agentId];
      },
    });
    if (isJson({ json })) writeJson(stdout, { jobs: filtered });
    else printJobList(stdout, filtered);
    return;
  }
  if (command === "input") {
    const id = positionalId || optionString(options, "id", "job-id");
    if (!id) throw new Error("job id is required for `jobs input`");
    const eventId = optionString(options, "event-id")?.trim();
    if (!eventId) throw new Error("--event-id is required for `jobs input`");
    const inputJson = option(options, "input-json");
    const inputFile = option(options, "input-file");
    if (inputJson === undefined && inputFile === undefined) {
      throw new Error(
        "--input-json or --input-file is required for `jobs input`",
      );
    }
    const inputData = await readJsonObject(inputJson, inputFile, "input");
    if (Object.keys(inputData).length === 0)
      throw new Error("input must not be empty");
    const { response } = await submitJobInput(
      client,
      id,
      { eventId, inputData },
      signal,
    );
    if (isJson({ json })) {
      writeJson(stdout, { jobId: id, eventId, input: response.data });
    } else {
      writeText(stdout, [`Submitted input for job ${id}`, `event: ${eventId}`]);
    }
    return;
  }
  if (command === "get") {
    const id = positionalId || optionString(options, "id", "job-id");
    if (!id) throw new Error("job id is required for `jobs get`");
    const { job } = await fetchJob(client, id, signal);
    const details =
      option(options, "details") === true ||
      option(options, "details") === "true"
        ? await collectJobDetails(client, id, signal)
        : {};
    if (isJson({ json })) writeJson(stdout, { job, ...details });
    else printJob(stdout, job, details);
    return;
  }
  throw new Error(`Unknown jobs subcommand: ${command}`);
}
