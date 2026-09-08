import {
  createCoworker,
  createCoworkerApiKey,
  fetchCoworkers,
  fetchCurrentCoworker,
  updateCoworker,
} from "../../api/services/coworker-service.js";
import {
  applyListFilters,
  type CommandContext,
  type CommandOptions,
  isJson,
  maskSecret,
  mergeChannels,
  normalizeCapabilities,
  option,
  optionBoolean,
  optionString,
  parseChannels,
  parseInteger,
  parsePositiveInteger,
  readOptionalJsonObject,
  record,
  truncate,
  writeJson,
  writeText,
} from "./command-helpers.js";

export interface CoworkersCommandContext extends CommandContext {
  subcommand?: string;
  positionalId?: string;
  options?: CommandOptions;
}

async function buildPayload(
  options: CommandOptions | undefined,
  update: boolean,
): Promise<Record<string, unknown>> {
  const metadata = await readOptionalJsonObject(
    option(options, "metadata-json"),
    option(options, "metadata-file"),
    "metadata",
  );
  const channels = parseChannels(option(options, "channel"));
  const payload: Record<string, unknown> = {};
  const values: [string, string][] = [
    ["name", "name"],
    ["caption", "caption"],
    ["company", "company"],
    ["companyLogo", "company-logo"],
    ["url", "url"],
    ["baseURL", "base-url"],
    ["description", "description"],
    ["image", "image"],
  ];
  for (const [key, name] of values) {
    const value = optionString(options, name);
    if (value !== undefined && (!update || key !== "name" || value !== ""))
      payload[key] = value;
  }
  const priority = parseInteger(option(options, "priority"), "--priority");
  if (priority !== undefined) payload.priority = priority;
  const rawCapabilities = option(options, "capability", "capabilities");
  if (rawCapabilities !== undefined)
    payload.capabilities = normalizeCapabilities(rawCapabilities);
  const mergedMetadata = mergeChannels(metadata, channels);
  if (mergedMetadata !== undefined) payload.metadata = mergedMetadata;
  return payload;
}

function printCoworkerList(
  stdout: CommandContext["stdout"],
  coworkers: readonly unknown[],
): void {
  if (!coworkers.length) {
    writeText(stdout, ["No coworkers matched."]);
    return;
  }
  const lines = ["Coworkers"];
  for (const raw of coworkers) {
    const coworker = record(raw);
    const capabilities =
      Array.isArray(coworker.capabilities) && coworker.capabilities.length
        ? coworker.capabilities.join(", ")
        : "none";
    lines.push(
      `${String(coworker.name || "Unnamed Coworker")} [${String(coworker.id || "unknown")}]`,
    );
    lines.push(`  capabilities: ${capabilities}`);
    if (coworker.company) lines.push(`  company: ${String(coworker.company)}`);
    if (coworker.baseURL) lines.push(`  baseURL: ${String(coworker.baseURL)}`);
    const channels = record(coworker.metadata).channels;
    if (channels && typeof channels === "object" && !Array.isArray(channels)) {
      const values = Object.entries(channels)
        .map(([provider, value]) => `${provider}=${String(value)}`)
        .join(", ");
      if (values) lines.push(`  channels: ${values}`);
    }
    if (coworker.description)
      lines.push(`  description: ${truncate(coworker.description, 140)}`);
  }
  writeText(stdout, lines);
}

function printCoworker(
  stdout: CommandContext["stdout"],
  coworker: unknown,
  heading = "",
): void {
  const value = record(coworker);
  const channels = record(value.metadata).channels;
  const channelText =
    channels && typeof channels === "object" && !Array.isArray(channels)
      ? Object.entries(channels)
          .map(([provider, item]) => `${provider}=${String(item)}`)
          .join(", ")
      : "";
  writeText(stdout, [
    heading ||
      `${String(value.name || "Unnamed Coworker")} [${String(value.id || "unknown")}]`,
    value.baseURL ? `baseURL: ${String(value.baseURL)}` : undefined,
    Array.isArray(value.capabilities) && value.capabilities.length
      ? `capabilities: ${value.capabilities.join(", ")}`
      : undefined,
    channelText ? `channels: ${channelText}` : undefined,
  ]);
}

export async function runCoworkersCommand({
  client,
  stdout,
  json = false,
  signal,
  subcommand,
  positionalId,
  options,
}: CoworkersCommandContext): Promise<void> {
  const command = subcommand || "list";
  if (command === "list") {
    const limit = parsePositiveInteger(option(options, "limit"), "--limit");
    const capabilities = normalizeCapabilities(
      option(options, "capability", "capabilities"),
    );
    const { coworkers } = await fetchCoworkers(
      client,
      { scope: optionString(options, "scope"), capabilities },
      signal,
    );
    const filtered = applyListFilters(coworkers, {
      search: option(options, "search"),
      limit,
      fields: (item) => {
        const value = record(item);
        return [
          value.id,
          value.slug,
          value.name,
          value.company,
          value.caption,
          value.description,
          ...(Array.isArray(value.capabilities) ? value.capabilities : []),
        ];
      },
    });
    if (isJson({ json })) writeJson(stdout, { coworkers: filtered });
    else printCoworkerList(stdout, filtered);
    return;
  }
  if (command === "register") {
    const payload = await buildPayload(options, false);
    const { coworker } = await createCoworker(
      client,
      payload as Parameters<typeof createCoworker>[1],
      signal,
    );
    let apiKey: unknown = null;
    if (optionBoolean(options, "create-api-key", "with-api-key")) {
      const result = await createCoworkerApiKey(
        client,
        String(record(coworker).id),
        {
          name: optionString(options, "api-key-name"),
          expiresAt: optionString(options, "api-key-expires-at"),
        },
        signal,
      );
      apiKey = result.apiKey;
    }
    if (isJson({ json })) writeJson(stdout, { coworker, apiKey });
    else {
      const coworkerValue = record(coworker);
      writeText(stdout, [
        `Created coworker ${String(coworkerValue.name || coworkerValue.id)} [${String(coworkerValue.id)}]`,
        coworkerValue.baseURL
          ? `baseURL: ${String(coworkerValue.baseURL)}`
          : undefined,
        Array.isArray(coworkerValue.capabilities)
          ? `capabilities: ${coworkerValue.capabilities.join(", ")}`
          : undefined,
        record(apiKey).token
          ? `coworker api key: ${maskSecret(record(apiKey).token)}`
          : undefined,
        record(apiKey).token
          ? "WARNING: Token is partially masked in text output. Use --json to retrieve the full token."
          : undefined,
        record(apiKey).token
          ? "Store this token securely. It is only returned once."
          : undefined,
      ]);
    }
    return;
  }
  if (command === "update") {
    const id = positionalId || optionString(options, "id", "coworker-id");
    if (!id) throw new Error("coworker id is required for `coworkers update`");
    const { coworker } = await updateCoworker(
      client,
      id,
      (await buildPayload(options, true)) as Parameters<
        typeof updateCoworker
      >[2],
      signal,
    );
    if (isJson({ json })) writeJson(stdout, { coworker });
    else
      printCoworker(
        stdout,
        coworker,
        `Updated coworker ${String(record(coworker).name || record(coworker).id)} [${String(record(coworker).id)}]`,
      );
    return;
  }
  if (command === "api-key") {
    const id = positionalId || optionString(options, "id", "coworker-id");
    if (!id) throw new Error("coworker id is required for `coworkers api-key`");
    const { apiKey } = await createCoworkerApiKey(
      client,
      id,
      {
        name: optionString(options, "name", "api-key-name"),
        expiresAt: optionString(options, "expires-at", "api-key-expires-at"),
      },
      signal,
    );
    if (isJson({ json })) writeJson(stdout, { coworkerId: id, apiKey });
    else
      writeText(stdout, [
        `Created API key for coworker ${id}`,
        record(apiKey).name
          ? `name: ${String(record(apiKey).name)}`
          : undefined,
        `token: ${maskSecret(record(apiKey).token)}`,
        "WARNING: Token is partially masked in text output. Use --json to retrieve the full token.",
        "Store this token securely. It is only returned once.",
      ]);
    return;
  }
  if (command === "me") {
    const { coworker } = await fetchCurrentCoworker(client, signal);
    if (isJson({ json })) writeJson(stdout, { coworker });
    else printCoworker(stdout, coworker);
    return;
  }
  throw new Error(`Unknown coworkers subcommand: ${command}`);
}
