import { spawn } from "node:child_process";
import { appendFile, glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tools that run inside the sandbox itself. They see only the bot's
 * workspace and the open web; Sokosumi data is reached through Core.
 */

export const WORKSPACE = process.cwd();

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_BASH_TIMEOUT_S = 120;
const MAX_FETCH_BYTES = 3_000_000;
const DEFAULT_FETCH_CHARS = 20_000;
const MAX_LIST_ENTRIES = 500;

function clip(text: string, limit = MAX_OUTPUT_CHARS): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n… [${text.length - limit} more characters]`
    : text;
}

/** Resolves a workspace path and refuses anything outside the workspace. */
export function workspacePath(relative = "."): string {
  const resolved = path.resolve(WORKSPACE, relative);
  if (resolved !== WORKSPACE && !resolved.startsWith(`${WORKSPACE}${path.sep}`))
    throw new Error("Path is outside the workspace");
  return resolved;
}

/** Commands get a plain environment: nothing the runner was started with. */
function commandEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    TERM: "dumb",
  };
}

export function runCommand(input: {
  command: string;
  timeoutSeconds?: number;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const timeoutMs = (input.timeoutSeconds ?? DEFAULT_BASH_TIMEOUT_S) * 1_000;
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", input.command], {
      cwd: WORKSPACE,
      env: commandEnv(),
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code,
        stdout: clip(stdout),
        stderr: clip(
          signal === "SIGKILL"
            ? `${stderr}\n[killed after ${timeoutMs / 1_000}s]`
            : stderr,
        ),
      });
    });
    child.on("error", (error) => {
      resolve({ exitCode: null, stdout: "", stderr: error.message });
    });
  });
}

export async function readWorkspaceFile(input: {
  path: string;
  offset?: number;
  limit?: number;
}): Promise<{ path: string; content: string; totalChars: number }> {
  const text = await readFile(workspacePath(input.path), "utf8");
  const offset = input.offset ?? 0;
  const limit = Math.min(input.limit ?? MAX_OUTPUT_CHARS * 2, 200_000);
  return {
    path: input.path,
    content: text.slice(offset, offset + limit),
    totalChars: text.length,
  };
}

export async function writeWorkspaceFile(input: {
  path: string;
  content: string;
  append?: boolean;
}): Promise<{ path: string; bytes: number }> {
  const target = workspacePath(input.path);
  await mkdir(path.dirname(target), { recursive: true });
  if (input.append) await appendFile(target, input.content);
  else await writeFile(target, input.content);
  return { path: input.path, bytes: Buffer.byteLength(input.content) };
}

export async function listWorkspace(input: {
  path?: string;
  pattern?: string;
}): Promise<{ files: string[]; truncated: boolean }> {
  const root = workspacePath(input.path);
  const files: string[] = [];
  for await (const entry of glob(input.pattern ?? "**/*", {
    cwd: root,
    exclude: (name) => name === "node_modules" || name === ".git",
  })) {
    files.push(path.relative(WORKSPACE, path.join(root, entry)));
    if (files.length >= MAX_LIST_ENTRIES) break;
  }
  return { files: files.sort(), truncated: files.length >= MAX_LIST_ENTRIES };
}

export async function searchWorkspace(input: {
  pattern: string;
  path?: string;
}): Promise<{ matches: string }> {
  const target = workspacePath(input.path);
  return new Promise((resolve) => {
    const child = spawn(
      "grep",
      [
        "-rnIE",
        "--exclude-dir=.git",
        "--exclude-dir=node_modules",
        "-m",
        "50",
        "--",
        input.pattern,
        target,
      ],
      { cwd: WORKSPACE, env: commandEnv(), timeout: 30_000 },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_CHARS * 2) output += chunk.toString();
    });
    child.on("close", () => {
      resolve({
        matches: clip(output.split(`${WORKSPACE}/`).join("")) || "(no matches)",
      });
    });
    child.on("error", (error) => resolve({ matches: error.message }));
  });
}

export function htmlToText(html: string): string {
  return (
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Last, so "&amp;lt;" stays the literal text "&lt;".
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim()
  );
}

export async function fetchWebPage(input: {
  url: string;
  maxChars?: number;
}): Promise<{
  url: string;
  status: number;
  contentType: string;
  text: string;
}> {
  const url = new URL(input.url);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Only http and https URLs can be fetched");
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "SokoBot/1.0 (+https://sokosumi.com)" },
  });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.byteLength;
    chunks.push(value);
    if (size >= MAX_FETCH_BYTES) {
      await reader.cancel();
      break;
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const contentType = response.headers.get("content-type") ?? "";
  const text = contentType.includes("html") ? htmlToText(raw) : raw;
  return {
    url: response.url,
    status: response.status,
    contentType,
    text: clip(text, input.maxChars ?? DEFAULT_FETCH_CHARS),
  };
}
