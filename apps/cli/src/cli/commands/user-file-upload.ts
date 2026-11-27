import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { CoreHttpClient } from "../../api/http-client.js";
import { parseApiResponse } from "../../api/models/api-response.js";
import { asRecord, nullableString } from "../../api/models/parse-helpers.js";
import { type CliOptions, GLOBAL_VALUE_OPTIONS } from "../help.js";
import {
  type CommandOutput,
  optionString,
  writeJson,
  writeText,
} from "./command-helpers.js";

const OPTIONS = new Set<string>([
  ...GLOBAL_VALUE_OPTIONS,
  "json",
  "preprod",
  "file",
]);
const USAGE = "Usage: sokosumi users file-upload me --file PATH";

interface UserFileUploadContext {
  client: CoreHttpClient;
  stdout: CommandOutput;
  json?: boolean;
  /** The positionals after `users file-upload`: the user id (`me`). */
  args: readonly string[];
  options?: CliOptions;
  signal?: AbortSignal;
}

function storedPathname(url: string | null): string | null {
  if (!url || !URL.canParse(url)) return null;
  const pathname = new URL(url).pathname.slice(1);
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Uploads one local file to the person's Sokosumi files: Core mints a signed
 * Blob upload (POST /users/{id}/files), then the bytes go straight to Blob.
 * The Core token is never sent to Blob.
 */
export async function runUserFileUpload({
  client,
  stdout,
  json = false,
  args,
  options,
  signal,
}: UserFileUploadContext): Promise<void> {
  const unknown = Object.keys(options ?? {}).find((name) => !OPTIONS.has(name));
  if (unknown)
    throw new Error(`\`users file-upload\` does not take --${unknown}`);
  const [userId, extra] = args;
  if (extra !== undefined) throw new Error(`Unexpected argument: ${extra}`);
  if (!userId?.trim() || userId === "." || userId === "..")
    throw new Error(USAGE);
  const path = optionString(options, "file");
  if (!path) throw new Error(`--file PATH is required. ${USAGE}`);

  const info = await stat(path);
  if (!info.isFile()) throw new Error(`--file must be a file: ${path}`);
  const size = info.size;
  const name = basename(path);
  // Core infers the type from the file name for a generic type, and refuses types it does not store.
  const { data } = parseApiResponse<unknown>(
    await client.post(
      `/v1/users/${encodeURIComponent(userId)}/files`,
      {
        filename: name,
        contentType: "application/octet-stream",
        size,
      },
      signal,
    ),
  );
  const grant = asRecord(data);
  const uploadUrl = nullableString(grant.uploadUrl);
  const contentType = nullableString(asRecord(grant.headers)["Content-Type"]);
  if (!uploadUrl?.startsWith("https://") || !contentType)
    throw new Error("Core returned no upload URL for the file");

  const bytes = await readFile(path);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal,
  });
  if (!response.ok)
    throw new Error(`Blob upload failed with status ${response.status}`);
  const stored = asRecord(await response.json().catch(() => null));
  const url = nullableString(stored.url);
  // The stored name has Blob's random suffix; only the returned URL carries it.
  const file = {
    name,
    url,
    pathname: storedPathname(url) ?? nullableString(grant.pathname),
    contentType,
    size: bytes.byteLength,
  };
  if (json) writeJson(stdout, { file });
  else
    writeText(stdout, [
      `Uploaded ${name} (${file.size} bytes, ${contentType})`,
      file.url ? `url: ${file.url}` : undefined,
      file.pathname ? `pathname: ${file.pathname}` : undefined,
    ]);
}
