import type { CoreHttpClient } from "../../api/http-client.js";
import { fetchAgents } from "../../api/services/agent-service.js";
import { fetchCoworkers } from "../../api/services/coworker-service.js";
import { fetchJobs } from "../../api/services/job-service.js";
import { type CliTargetConfig, sanitizeApiUrl } from "../../auth/config.js";
import { redactErrorMessage } from "../../error-redaction.js";
import type { CommandOutput } from "./command-helpers.js";

interface CliCommandCatalogEntry {
  readonly command: string;
  readonly usage: string;
}

export const CLI_COMMAND_CATALOG = [
  { command: "discover", usage: "" },
  { command: "skills", usage: "" },
  { command: "skills path", usage: "" },
  { command: "auth login", usage: "" },
  { command: "auth status", usage: "" },
  { command: "auth whoami", usage: "" },
  { command: "auth logout", usage: "" },
  { command: "admin members", usage: "WORKSPACE_SLUG" },
  { command: "admin add-member", usage: "WORKSPACE_SLUG --email EMAIL" },
  { command: "admin assign-seat", usage: "WORKSPACE_SLUG --email EMAIL" },
  { command: "agents list", usage: "" },
  { command: "agents hire", usage: "AGENT_ID" },
  { command: "coworkers list", usage: "" },
  { command: "coworkers register", usage: "[--personal] [options]" },
  { command: "coworkers provision", usage: "[options]" },
  { command: "coworkers connect", usage: "COWORKER_ID [--personal] [options]" },
  { command: "coworkers update", usage: "COWORKER_ID [options]" },
  { command: "coworkers api-key", usage: "COWORKER_ID [options]" },
  { command: "coworkers me", usage: "" },
  { command: "vendors me", usage: "" },
  { command: "vendors create", usage: "--name NAME --slug SLUG" },
  { command: "workspaces list", usage: "[--personal]" },
  { command: "workspaces check", usage: "ORGANIZATION_ID" },
  { command: "runtime key-import", usage: "[options]" },
  { command: "runtime start", usage: "TASK_ID [options]" },
  { command: "runtime complete", usage: "TASK_ID [options]" },
  { command: "runtime run", usage: "TASK_ID [options]" },
  { command: "runtime receipt", usage: "TASK_ID [options]" },
  { command: "tasks list", usage: "[options]" },
  {
    command: "tasks create",
    usage: "[--organization-slug WORKSPACE_SLUG | --personal]",
  },
  {
    command: "tasks get",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks events",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks jobs",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  {
    command: "tasks comment",
    usage: "TASK_ID [--organization-slug WORKSPACE_SLUG]",
  },
  { command: "jobs list", usage: "" },
  { command: "jobs get", usage: "JOB_ID" },
  { command: "jobs input", usage: "JOB_ID" },
] as const satisfies readonly CliCommandCatalogEntry[];

type CliCommand = (typeof CLI_COMMAND_CATALOG)[number]["command"];

export const CLI_COMMANDS: readonly CliCommand[] = CLI_COMMAND_CATALOG.map(
  (entry) => entry.command,
);

export function formatCliCommandHelpLines(): string {
  return CLI_COMMAND_CATALOG.map((entry) =>
    entry.usage
      ? `  sokosumi ${entry.command} ${entry.usage}`
      : `  sokosumi ${entry.command}`,
  ).join("\n");
}

export function formatUnknownCommandUsage(): string {
  return `Usage: sokosumi ${CLI_COMMANDS.join(" | ")}`;
}

export interface DiscoverCommandOptions {
  client?: CoreHttpClient;
  config: CliTargetConfig;
  stdout: CommandOutput;
  json?: boolean;
  signal?: AbortSignal;
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
        message: redactErrorMessage(agentsResult.reason),
      });
    }
    if (coworkersResult.status === "rejected") {
      errors.push({
        resource: "coworkers",
        message: redactErrorMessage(coworkersResult.reason),
      });
    }
    if (jobsResult.status === "rejected") {
      errors.push({
        resource: "jobs",
        message: redactErrorMessage(jobsResult.reason),
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
