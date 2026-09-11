import type { CoreHttpClient } from "../../api/http-client.js";
import { fetchAgents } from "../../api/services/agent-service.js";
import { fetchCoworkers } from "../../api/services/coworker-service.js";
import { fetchJobs } from "../../api/services/job-service.js";
import { type CliTargetConfig, sanitizeApiUrl } from "../../auth/config.js";
import { redactErrorMessage } from "../../error-redaction.js";

interface TextOutput {
  write(value: string): unknown;
}

export const CLI_COMMANDS = [
  "discover",
  "auth login",
  "auth status",
  "auth logout",
  "agents list",
  "agents hire",
  "coworkers list",
  "coworkers register",
  "coworkers update",
  "coworkers api-key",
  "coworkers me",
  "tasks list",
  "tasks create",
  "tasks get",
  "tasks events",
  "tasks jobs",
  "tasks comment",
  "jobs list",
  "jobs get",
  "jobs input",
] as const;

export interface DiscoverCommandOptions {
  client?: CoreHttpClient;
  config: CliTargetConfig;
  stdout: TextOutput;
  json?: boolean;
  signal?: AbortSignal;
}

function errorMessage(reason: unknown): string {
  return redactErrorMessage(reason);
}

export async function runDiscoverCommand({
  client,
  config,
  stdout,
  json = false,
  signal,
}: DiscoverCommandOptions): Promise<void> {
  const result: {
    apiUrl: string;
    environment: string;
    commands: readonly string[];
    agents?: unknown[];
    coworkers?: unknown[];
    jobs?: unknown[];
    errors?: { resource: string; message: string }[];
  } = {
    apiUrl: sanitizeApiUrl(config.apiUrl),
    environment: config.target,
    commands: [...CLI_COMMANDS],
  };

  if (client) {
    const [agentsResult, coworkersResult, jobsResult] =
      await Promise.allSettled([
        fetchAgents(client, signal),
        fetchCoworkers(client, {}, signal),
        fetchJobs(client, signal),
      ]);
    const errors: { resource: string; message: string }[] = [];
    result.agents =
      agentsResult.status === "fulfilled" ? agentsResult.value.agents : [];
    result.coworkers =
      coworkersResult.status === "fulfilled"
        ? coworkersResult.value.coworkers
        : [];
    result.jobs =
      jobsResult.status === "fulfilled" ? jobsResult.value.jobs : [];
    if (agentsResult.status === "rejected") {
      errors.push({
        resource: "agents",
        message: errorMessage(agentsResult.reason),
      });
    }
    if (coworkersResult.status === "rejected") {
      errors.push({
        resource: "coworkers",
        message: errorMessage(coworkersResult.reason),
      });
    }
    if (jobsResult.status === "rejected") {
      errors.push({
        resource: "jobs",
        message: errorMessage(jobsResult.reason),
      });
    }
    if (errors.length > 0) result.errors = errors;
  }

  if (json) {
    stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const lines = [
    "Sokosumi CLI",
    `API: ${result.apiUrl} [${result.environment}]`,
    "",
  ];
  if (result.agents) {
    lines.push(`Agents (${result.agents.length}):`);
    for (const agent of result.agents) {
      const value = agent as {
        id?: string | null;
        name?: string | null;
        status?: string | null;
      };
      lines.push(
        `  ${value.name || "Unnamed"} [${value.id || "unknown"}] - ${value.status || "unknown"}`,
      );
    }
    lines.push("");
  }
  if (result.coworkers) {
    lines.push(`Coworkers (${result.coworkers.length}):`);
    for (const coworker of result.coworkers) {
      const value = coworker as {
        id?: string | null;
        name?: string | null;
        capabilities?: unknown[];
      };
      lines.push(
        `  ${value.name || "Unnamed"} [${value.id || "unknown"}] - ${Array.isArray(value.capabilities) ? value.capabilities.join(", ") || "none" : "none"}`,
      );
    }
    lines.push("");
  }
  if (result.jobs) {
    lines.push(`Jobs (${result.jobs.length}):`);
    for (const job of result.jobs) {
      const value = job as {
        id?: string | null;
        name?: string | null;
        status?: string | null;
      };
      lines.push(
        `  ${value.name || value.id || "Unnamed"} [${value.id || "unknown"}] - ${value.status || "unknown"}`,
      );
    }
    lines.push("");
  }
  lines.push("Commands:", ...result.commands.map((command) => `  ${command}`));
  if (result.errors?.length) {
    lines.push(
      "",
      "Errors:",
      ...result.errors.map((error) => `  ${error.resource}: ${error.message}`),
    );
  }
  stdout.write(`${lines.join("\n")}\n`);
}
