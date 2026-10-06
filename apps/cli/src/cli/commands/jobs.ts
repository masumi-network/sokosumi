import type { AgentJob } from "../../api/models/agent-job.js";
import type { JobEvent } from "../../api/models/job-event.js";
import type { JobFile, JobLink } from "../../api/models/job-output.js";
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
  option,
  optionBoolean,
  optionString,
  parsePositiveInteger,
  readJsonObject,
  truncate,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface JobsCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

interface JobDetails {
  events?: JobEvent[];
  files?: JobFile[];
  links?: JobLink[];
  inputRequest?: unknown;
  detailsErrors?: { resource: string; message: string }[];
}

function printJobList(
  stdout: CommandContext["stdout"],
  jobs: readonly AgentJob[],
): void {
  if (!jobs.length) return writeText(stdout, ["No jobs found."]);
  const lines = ["Jobs"];
  for (const job of jobs) {
    lines.push(
      `${job.name || job.id || "Unnamed Job"} [${job.id || "unknown"}]`,
    );
    lines.push(
      `  status: ${job.status || "unknown"} | agent: ${job.agentId || "-"}`,
    );
    if (job.result) lines.push(`  result: ${truncate(job.result, 160)}`);
  }
  writeText(stdout, lines);
}

function printJob(
  stdout: CommandContext["stdout"],
  job: AgentJob,
  details: JobDetails,
): void {
  const lines: (string | undefined)[] = [
    `Job ${job.id || "unknown"}`,
    `status: ${job.status || "unknown"}`,
    `agent: ${job.agentId || "-"}`,
    job.name ? `name: ${job.name}` : undefined,
    job.result ? `result: ${job.result}` : undefined,
  ];
  if (details.inputRequest) lines.push("input request: pending");
  const events = details.events ?? [];
  if (events.length) {
    const latestEvent = events[0];
    lines.push(
      `events: ${events.length}`,
      `latest event: ${truncate(latestEvent.result || latestEvent.message || latestEvent.status || latestEvent.type || latestEvent.id, 160)}`,
    );
  }
  const files = details.files ?? [];
  if (files.length) {
    lines.push(`files: ${files.length}`);
    for (const file of files.slice(0, 3)) {
      lines.push(`  ${file.name || file.id || "file"}: ${file.url || "-"}`);
    }
  }
  const links = details.links ?? [];
  if (links.length) {
    lines.push(`links: ${links.length}`);
    for (const link of links.slice(0, 3)) {
      lines.push(`  ${link.title || link.id || "link"}: ${link.url || "-"}`);
    }
  }
  if (details.detailsErrors?.length)
    lines.push(
      `detail errors: ${details.detailsErrors.map((item) => item.resource).join(", ")}`,
    );
  writeText(stdout, lines);
}

async function collectJobDetails(
  client: CommandContext["client"],
  id: string,
  signal?: AbortSignal,
): Promise<JobDetails> {
  const results = await Promise.allSettled([
    fetchJobEvents(client, id, signal),
    fetchJobFiles(client, id, signal),
    fetchJobLinks(client, id, signal),
    fetchJobInputRequest(client, id, signal),
  ]);
  const details: JobDetails = {};
  const errors: { resource: string; message: string }[] = [];
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
      fields: (item) => [item.id, item.name, item.status, item.agentId],
    });
    if (json) writeJson(stdout, { jobs: filtered });
    else printJobList(stdout, filtered);
    return;
  }
  if (command === "input") {
    const id = positionalId || optionString(options, "id");
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
    if (json) {
      writeJson(stdout, { jobId: id, eventId, input: response.data });
    } else {
      writeText(stdout, [`Submitted input for job ${id}`, `event: ${eventId}`]);
    }
    return;
  }
  if (command === "get") {
    const id = positionalId || optionString(options, "id");
    if (!id) throw new Error("job id is required for `jobs get`");
    const { job } = await fetchJob(client, id, signal);
    const details = optionBoolean(options, "details")
      ? await collectJobDetails(client, id, signal)
      : {};
    if (json) writeJson(stdout, { job, ...details });
    else printJob(stdout, job, details);
    return;
  }
  throw new Error(`Unknown jobs subcommand: ${command}`);
}
