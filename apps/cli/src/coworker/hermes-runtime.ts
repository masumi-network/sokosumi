import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, normalize } from "node:path";

import type { RuntimeTask } from "./runtime-task.js";

export interface HermesRuntimeOptions {
  provider?: string;
  model?: string;
  hermesPath?: string;
  runtimeDirectory: string;
  hermesHome: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ExecuteHermesTaskOptions extends HermesRuntimeOptions {
  task: RuntimeTask;
}

const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_PROMPT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const REQUIRED_FLAGS = [
  "--query-file",
  "--oneshot",
  "--format",
  "stream-json",
  "--source",
  "--max-turns",
];
const OS_ENVIRONMENT = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
];
const PROVIDER_ENVIRONMENT: Record<string, readonly string[]> = {
  openrouter: ["OPENROUTER_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  "openai-api": ["OPENAI_API_KEY"],
};

function childEnvironment(
  options: HermesRuntimeOptions,
  hermesHome: string,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    ...OS_ENVIRONMENT,
    ...(options.provider !== undefined &&
    Object.hasOwn(PROVIDER_ENVIRONMENT, options.provider)
      ? PROVIDER_ENVIRONMENT[options.provider]
      : []),
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  environment.HERMES_HOME = hermesHome;
  return environment;
}

async function validateOptions(options: HermesRuntimeOptions): Promise<void> {
  if (options.signal?.aborted) throw new Error("Hermes execution was aborted.");
  for (const value of [options.provider, options.model]) {
    if (value === undefined) continue;
    if (!value.trim() || value.length > 256 || /[\r\n\0]/.test(value)) {
      throw new Error(
        "Hermes provider and model must be nonempty identifiers.",
      );
    }
  }
  if (
    options.hermesPath !== undefined &&
    (!options.hermesPath.trim() ||
      /[\r\n\0]/.test(options.hermesPath) ||
      (!isAbsolute(options.hermesPath) && options.hermesPath !== "hermes"))
  ) {
    throw new Error(
      "Hermes executable must be an absolute path or hermes on PATH.",
    );
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      options.timeoutMs > 600_000)
  ) {
    throw new Error(
      "Hermes timeout must be a positive bounded integer of at most 600000 milliseconds.",
    );
  }
  const hermesHome = normalize(options.hermesHome);
  if (hermesHome !== hermesHome.trim()) {
    throw new Error("Hermes home must not start or end with whitespace.");
  }
  for (const directory of [options.runtimeDirectory, hermesHome]) {
    if (!isAbsolute(directory)) {
      throw new Error(
        "Hermes runtime and home directories must be absolute paths.",
      );
    }
    let directoryExists = false;
    try {
      directoryExists = (await stat(directory)).isDirectory();
    } catch {
      // Do not include a filesystem error that can contain private paths.
    }
    if (!directoryExists) {
      throw new Error(
        "Hermes runtime and home directories must already exist.",
      );
    }
  }
}

function runHermes(
  options: HermesRuntimeOptions,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Hermes execution was aborted."));
      return;
    }
    const hermesHome = normalize(options.hermesHome);
    // Hermes trusts named-profile homes directly. Other homes need an explicit
    // default profile so active_profile cannot select a different home.
    const profileArgs =
      basename(dirname(hermesHome)) === "profiles"
        ? args
        : ["--profile", "default", ...args];
    const child = spawn(options.hermesPath ?? "hermes", profileArgs, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.runtimeDirectory,
      env: childEnvironment(options, hermesHome),
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // The child may already have exited. Its close event completes the call.
      }
    };
    const timer = setTimeout(
      () => stop("Hermes execution timed out."),
      timeoutMs,
    );
    const onAbort = () => stop("Hermes execution was aborted.");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stop("Hermes output exceeded the allowed size.");
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) {
        stop("Hermes diagnostics exceeded the allowed size.");
      }
    });
    child.stdin.on("error", () =>
      stop("Hermes could not read the Task input."),
    );
    child.on("error", () => {
      failure ??= new Error(
        "Hermes could not start. Check the executable and installation.",
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error("Hermes did not complete successfully."));
      else resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.end(input);
  });
}

export async function preflightHermesRuntime(
  options: HermesRuntimeOptions,
): Promise<void> {
  await validateOptions(options);
  const timeout = Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10_000);
  const version = await runHermes(options, ["--version"], "", timeout);
  if (!version.trim()) throw new Error("Hermes did not report its version.");
  const help = await runHermes(
    options,
    ["--cli", "chat", "--help"],
    "",
    timeout,
  );
  const requiredFlags = [
    ...REQUIRED_FLAGS,
    ...(options.provider === undefined ? [] : ["--provider"]),
    ...(options.model === undefined ? [] : ["--model"]),
  ];
  if (!requiredFlags.every((flag) => help.includes(flag))) {
    throw new Error(
      "Hermes installation does not support the required one-shot JSON interface.",
    );
  }
}

export async function executeHermesTask(
  options: ExecuteHermesTaskOptions,
): Promise<string> {
  await validateOptions(options);
  const prompt = JSON.stringify({
    name: options.task.name,
    description: options.task.description,
  });
  if (
    !options.task.name.trim() ||
    Buffer.byteLength(prompt) > MAX_PROMPT_BYTES
  ) {
    throw new Error("Task text is empty or exceeds the Hermes input limit.");
  }
  const output = await runHermes(
    options,
    [
      "--cli",
      "chat",
      "--query-file",
      "-",
      "--oneshot",
      "--format",
      "stream-json",
      "--source",
      "tool",
      "--max-turns",
      "10",
      ...(options.provider === undefined
        ? []
        : ["--provider", options.provider]),
      ...(options.model === undefined ? [] : ["--model", options.model]),
    ],
    `Complete this Task and return the finished result as your final response.\n${prompt}`,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let result: string | undefined;
  for (const line of output.split(/\r?\n/).filter((value) => value.trim())) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error("Hermes returned invalid JSON output.");
    }
    if (
      result !== undefined ||
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      !("type" in event) ||
      typeof event.type !== "string"
    ) {
      throw new Error("Hermes returned an invalid event sequence.");
    }
    if (event.type === "result") {
      if (
        !("exit_code" in event) ||
        event.exit_code !== 0 ||
        !("text" in event) ||
        typeof event.text !== "string" ||
        !event.text.trim() ||
        "error" in event
      ) {
        throw new Error("Hermes did not return a successful final result.");
      }
      result = event.text;
    }
  }
  if (result === undefined) throw new Error("Hermes returned no final result.");
  return result;
}
