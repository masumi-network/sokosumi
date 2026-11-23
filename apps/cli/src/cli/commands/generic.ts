import type { CoreHttpClient } from "../../api/http-client.js";
import type { CliCommandCatalogEntry } from "./catalog.js";
import {
  asArray,
  type CommandOptions,
  type CommandOutput,
  option,
  readJsonObject,
  writeJson,
} from "./command-helpers.js";

const PATH_PARAM = /\{[^}]+\}/g;

export interface GenericCommandContext {
  client: CoreHttpClient;
  stdout: CommandOutput;
  row: CliCommandCatalogEntry & { readonly operation: string };
  /** The positionals after the command words, in path-parameter order. */
  args: readonly string[];
  options?: CommandOptions;
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
  const [method, template] = row.operation.split(" ");
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
  let index = 0;
  const path = `/v1${template.replace(PATH_PARAM, () => encodeURIComponent(args[index++]))}${query.size ? `?${query}` : ""}`;

  const inputJson = option(options, "input-json");
  const inputFile = option(options, "input-file");
  const read = method === "GET" || method === "DELETE";
  if (read && (inputJson !== undefined || inputFile !== undefined))
    throw new Error(`\`${row.command}\` takes no --input-json or --input-file`);
  const body = read
    ? undefined
    : await readJsonObject(inputJson, inputFile, "--input");
  let response: unknown;
  if (method === "GET") response = await client.get(path, signal);
  else if (method === "DELETE") response = await client.delete(path, signal);
  else if (method === "POST") response = await client.post(path, body, signal);
  else if (method === "PUT") response = await client.put(path, body, signal);
  else response = await client.patch(path, body, signal);
  writeJson(stdout, response ?? null);
}
