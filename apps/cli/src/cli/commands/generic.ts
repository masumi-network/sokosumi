import type { CoreHttpClient } from "../../api/http-client.js";
import { resolveTaskId } from "../../api/services/task-service.js";
import { type CliOptions, GLOBAL_VALUE_OPTIONS } from "../help.js";
import type { CliCommandCatalogEntry, CoreMethod } from "./catalog.js";
import {
  asArray,
  type CommandOutput,
  option,
  readJsonObject,
  writeJson,
} from "./command-helpers.js";

const PATH_PARAM = /\{[^}]+\}/g;
const OPTIONS = new Set<string>([
  ...GLOBAL_VALUE_OPTIONS,
  "json",
  "preprod",
  "query",
  "input-json",
  "input-file",
  "organization-slug",
]);

export interface GenericCommandContext {
  client: CoreHttpClient;
  stdout: CommandOutput;
  row: CliCommandCatalogEntry &
    Required<Pick<CliCommandCatalogEntry, "operation">>;
  /** The positionals after the command words, in path-parameter order. */
  args: readonly string[];
  options?: CliOptions;
  signal?: AbortSignal;
}

/** Runs a catalog row's Core operation and prints Core's JSON body. */
export async function runGenericCommand({
  client,
  stdout,
  row,
  args,
  options,
  signal,
}: GenericCommandContext): Promise<void> {
  const unknown = Object.keys(options ?? {}).find((name) => !OPTIONS.has(name));
  if (unknown) throw new Error(`\`${row.command}\` does not take --${unknown}`);
  const [method, template] = row.operation.split(" ") as [CoreMethod, string];
  const params = template.match(PATH_PARAM) ?? [];
  if (args.length > params.length)
    throw new Error(`Unexpected argument: ${args[params.length]}`);
  if (
    args.length < params.length ||
    args.some((arg) => !arg.trim() || arg === "." || arg === "..")
  )
    throw new Error(`Usage: sokosumi ${row.command} ${row.usage}`);

  const query = new URLSearchParams();
  for (const pair of asArray(option(options, "query"))) {
    const equals = pair.indexOf("=");
    if (equals <= 0) throw new Error(`--query expects KEY=VALUE, got ${pair}`);
    query.append(pair.slice(0, equals), pair.slice(equals + 1));
  }
  const inputJson = option(options, "input-json");
  const inputFile = option(options, "input-file");
  const read = method === "GET" || method === "DELETE" || row.noBody === true;
  const input = inputJson !== undefined || inputFile !== undefined;
  if (read && input)
    throw new Error(`\`${row.command}\` takes no --input-json or --input-file`);
  if (!read && !input)
    throw new Error(`\`${row.command}\` needs --input-json or --input-file`);
  const body = read
    ? undefined
    : await readJsonObject(inputJson, inputFile, "--input");
  // Only GET /tasks/{id} resolves a short identifier such as SOK-12.
  const values = template.startsWith("/tasks/{id}/")
    ? [await resolveTaskId(client, args[0]!, signal), ...args.slice(1)]
    : args;
  let index = 0;
  const path = `/v1${template.replace(PATH_PARAM, () => encodeURIComponent(values[index++]!))}${query.size ? `?${query}` : ""}`;
  let response: unknown;
  switch (method) {
    case "GET":
      response = await client.get(path, signal);
      break;
    case "DELETE":
      response = await client.delete(path, signal);
      break;
    case "POST":
      response = await client.post(path, body, signal);
      break;
    case "PUT":
      response = await client.put(path, body, signal);
      break;
    case "PATCH":
      response = await client.patch(path, body, signal);
      break;
    default:
      throw new Error(`Unsupported method in ${row.operation}`);
  }
  writeJson(stdout, response ?? null);
}
