import { readFile } from "node:fs/promises";
import type { CoreHttpClient } from "../../api/http-client.js";

export interface CommandOutput {
  write(value: string): unknown;
}

export interface CommandContext {
  client: CoreHttpClient;
  stdout: CommandOutput;
  json?: boolean;
  signal?: AbortSignal;
}

export type CommandOption = string | string[] | boolean | undefined;
export type CommandOptions = Record<string, CommandOption>;

export function option(
  options: CommandOptions | undefined,
  ...names: string[]
): CommandOption {
  for (const name of names) {
    if (options?.[name] !== undefined) return options[name];
  }
  return undefined;
}

export function optionString(
  options: CommandOptions | undefined,
  ...names: string[]
): string | undefined {
  const value = option(options, ...names);
  if (value === undefined || typeof value === "boolean") return undefined;
  return Array.isArray(value) ? value[value.length - 1] : value;
}

export function optionBoolean(
  options: CommandOptions | undefined,
  ...names: string[]
): boolean {
  const value = option(options, ...names);
  return value === true || value === "true";
}

export function asArray(value: CommandOption): string[] {
  if (value === undefined || typeof value === "boolean") return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function parsePositiveInteger(
  value: CommandOption,
  label = "value",
): number | undefined {
  const text =
    value === undefined || typeof value === "boolean"
      ? undefined
      : String(Array.isArray(value) ? value.at(-1) : value).trim();
  if (text === undefined || text === "") return undefined;
  if (!/^\+?[1-9]\d*$/.test(text))
    throw new Error(`${label} must be a positive integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export function parseInteger(
  value: CommandOption,
  label = "value",
): number | undefined {
  const text =
    value === undefined || typeof value === "boolean"
      ? undefined
      : String(Array.isArray(value) ? value.at(-1) : value).trim();
  if (text === undefined || text === "") return undefined;
  if (!/^[+-]?\d+$/.test(text)) throw new Error(`${label} must be an integer`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${label} must be an integer`);
  return parsed;
}

const TASK_STATUSES = [
  "DRAFT",
  "READY",
  "RUNNING",
  "COMPLETED",
  "CANCELED",
  "CANCELLED",
  "FAILED",
  "INPUT_REQUIRED",
  "OUT_OF_CREDITS",
] as const;

export function validateStatus(
  value: CommandOption,
  allowed: readonly string[] = TASK_STATUSES,
): string | undefined {
  const text =
    value === undefined || typeof value === "boolean"
      ? undefined
      : String(Array.isArray(value) ? value.at(-1) : value)
          .trim()
          .toUpperCase();
  if (!text) return undefined;
  if (!allowed.includes(text))
    throw new Error(`--status must be one of: ${allowed.join(", ")}`);
  return text;
}

export function normalizeCapabilities(value: CommandOption): string[] {
  const capabilities = asArray(value).flatMap((item) =>
    item
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const capability of capabilities) {
    if (capability !== "chat" && capability !== "tasks") {
      throw new Error(
        `Invalid capability "${capability}". Allowed values: chat, tasks`,
      );
    }
  }
  return [...new Set(capabilities)];
}

export function normalizeSearch(value: CommandOption): string {
  if (value === undefined || typeof value === "boolean") return "";
  return String(Array.isArray(value) ? value.at(-1) : value)
    .trim()
    .toLowerCase();
}

export function applyListFilters<T>(
  items: readonly T[],
  input: {
    search?: CommandOption;
    limit?: number;
    fields: (item: T) => unknown[];
  },
): T[] {
  const needle = normalizeSearch(input.search);
  const filtered = needle
    ? items.filter((item) =>
        input
          .fields(item)
          .filter((value) => value !== null && value !== undefined)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : [...items];
  return input.limit === undefined ? filtered : filtered.slice(0, input.limit);
}

export async function readJsonObject(
  jsonText: CommandOption,
  filePath: CommandOption,
  label: string,
): Promise<Record<string, unknown>> {
  if (jsonText !== undefined && filePath !== undefined)
    throw new Error(`Pass either ${label}-json or ${label}-file, not both`);
  if (jsonText === undefined && filePath === undefined) return {};
  const source =
    filePath !== undefined
      ? await readFile(optionText(filePath), "utf8")
      : optionText(jsonText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Failed to parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}

export async function readOptionalJsonObject(
  jsonText: CommandOption,
  filePath: CommandOption,
  label: string,
): Promise<Record<string, unknown> | undefined> {
  if (jsonText === undefined && filePath === undefined) return undefined;
  return readJsonObject(jsonText, filePath, label);
}

function optionText(value: CommandOption): string {
  if (value === undefined || typeof value === "boolean") return "";
  return String(Array.isArray(value) ? (value.at(-1) ?? "") : value);
}

export function parseChannels(value: CommandOption): Record<string, string> {
  const channels: Record<string, string> = {};
  for (const entry of asArray(value)) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1)
      throw new Error(
        `Invalid --channel value "${entry}". Use provider=value.`,
      );
    const provider = entry.slice(0, separator).trim();
    const channel = entry.slice(separator + 1).trim();
    if (!provider || !channel)
      throw new Error(
        `Invalid --channel value "${entry}". Use provider=value.`,
      );
    channels[provider] = channel;
  }
  return channels;
}

export function mergeChannels(
  metadata: Record<string, unknown> | undefined,
  channels: Record<string, string>,
): Record<string, unknown> | undefined {
  const existing =
    metadata?.channels &&
    typeof metadata.channels === "object" &&
    !Array.isArray(metadata.channels)
      ? (metadata.channels as Record<string, unknown>)
      : {};
  if (!metadata && Object.keys(channels).length === 0) return undefined;
  return {
    ...(metadata ?? {}),
    ...(Object.keys(channels).length
      ? { channels: { ...existing, ...channels } }
      : {}),
  };
}

export function writeJson(stdout: CommandOutput, payload: unknown): void {
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeText(
  stdout: CommandOutput,
  lines: readonly (string | undefined | null | false)[],
): void {
  stdout.write(`${lines.filter(Boolean).join("\n")}\n`);
}

export function formatDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function truncate(value: unknown, max = 100): string {
  const text = String(value ?? "").trim();
  return !text ? "" : text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function maskSecret(value: unknown): string {
  const token = typeof value === "string" ? value : "";
  return token ? `${token.slice(0, 8)}..${token.slice(-4)}` : "(none)";
}

export function isJson(context: Pick<CommandContext, "json">): boolean {
  return context.json === true;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
