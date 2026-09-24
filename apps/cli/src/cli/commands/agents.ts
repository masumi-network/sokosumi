import {
  createAgentJob,
  fetchAgentInputSchema,
  fetchAgents,
} from "../../api/services/agent-service.js";
import {
  applyListFilters,
  type CommandContext,
  type CommandOptions,
  option,
  optionString,
  parsePositiveInteger,
  readJsonObject,
  record,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface AgentsCommandOptions extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

function printAgentList(
  stdout: CommandContext["stdout"],
  agents: readonly {
    id: string | null;
    name: string | null;
    status: string | null;
  }[],
): void {
  if (agents.length === 0) {
    stdout.write("No agents found.\n");
    return;
  }
  stdout.write(
    `${agents
      .map(
        (agent) =>
          `${agent.name || "Unnamed"} [${agent.id || "unknown"}] | ${agent.status || "unknown"}`,
      )
      .join("\n")}\n`,
  );
}

export async function runAgentsCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
  positionalId,
  options,
}: AgentsCommandOptions): Promise<void> {
  const command = subcommand || "list";
  if (command === "list") {
    const { agents } = await fetchAgents(client, signal);
    const filtered = applyListFilters(agents, {
      search: option(options, "search"),
      limit: parsePositiveInteger(option(options, "limit"), "--limit"),
      fields: (agent) => [
        agent.id,
        agent.name,
        agent.description,
        ...agent.tags.map((tag) => tag.name),
      ],
    });
    if (json) {
      writeJson(stdout, { agents: filtered });
      return;
    }
    printAgentList(stdout, filtered);
    return;
  }

  if (command === "hire") {
    const agentId = positionalId || optionString(options, "agent");
    if (!agentId) throw new Error("agent id is required for `agents hire`");
    const inputJson = option(options, "input-json");
    const inputFile = option(options, "input-file");
    if (inputJson === undefined && inputFile === undefined) {
      throw new Error(
        "--input-json or --input-file is required for `agents hire`",
      );
    }
    const inputData = await readJsonObject(inputJson, inputFile, "input");
    const { schema } = await fetchAgentInputSchema(client, agentId, signal);
    const { job } = await createAgentJob(
      client,
      agentId,
      {
        inputSchema: schema,
        inputData,
        maxCredits: parsePositiveInteger(
          option(options, "max-credits"),
          "--max-credits",
        ),
        name: optionString(options, "name"),
      },
      signal,
    );
    if (json) {
      writeJson(stdout, { job });
      return;
    }
    const value = record(job);
    writeText(stdout, [
      `Created job ${String(value.id || "unknown")}`,
      `agent: ${String(value.agentId || agentId)}`,
      `status: ${String(value.status || "unknown")}`,
    ]);
    return;
  }

  throw new Error(`Unknown agents subcommand: ${command}`);
}
