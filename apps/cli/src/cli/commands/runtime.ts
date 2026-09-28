import { closeSync, openSync, readSync } from "node:fs";
import { createCoworkerHttpClient } from "../../api/http-client.js";
import type { CredentialStore } from "../../auth/secure-store.js";
import {
  parseRuntimeKeyInput,
  type RuntimeCredential,
  readRuntimeCredential,
  saveRuntimeCredential,
} from "../../coworker/runtime-credentials.js";
import {
  completeRuntimeTask,
  startRuntimeTask,
} from "../../coworker/runtime-task.js";
import { redactErrorMessage, redactSensitive } from "../../error-redaction.js";
import {
  type CommandOptions,
  type CommandOutput,
  optionString,
  record,
  writeJson,
} from "./command-helpers.js";

export interface RuntimeDependencies {
  fetchImpl?: typeof fetch;
  credentialStore?: CredentialStore<RuntimeCredential>;
}

const COMMON_OPTIONS = new Set([
  "preprod",
  "json",
  "api-key-stdin",
  "coworker-id",
  "organization-id",
]);
const COMPLETE_OPTIONS = new Set(["result-file"]);
const NO_OPTIONS = new Set<string>();

function readBoundedInput(fd: number, limit: number): string {
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < buffer.length) {
    const count = readSync(fd, buffer, size, buffer.length - size, null);
    if (count === 0) break;
    size += count;
  }
  if (size > limit) throw new Error("Runtime input exceeds the size limit");
  return new TextDecoder("utf-8", { fatal: true }).decode(
    buffer.subarray(0, size),
  );
}

function readRuntimeStdin(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.off("close", onClose);
      signal.removeEventListener("abort", onAbort);
      input.pause();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 16_384) {
        fail("Runtime input exceeds the size limit");
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        reject(new Error("Runtime key input must contain valid UTF-8 text"));
      }
    };
    const onError = () => fail("Could not read runtime key input");
    const onClose = () => fail("Runtime key input closed before completion");
    const onAbort = () => fail("Runtime key input was aborted or timed out");
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    input.once("end", onEnd);
    input.once("error", onError);
    input.once("close", onClose);
    input.on("data", onData);
  });
}

function requiredOption(options: CommandOptions, name: string): string {
  const value = optionString(options, name)?.trim();
  if (!value) throw new Error(`runtime requires --${name}`);
  return value;
}

function readRuntimeFile(path: string, limit: number, message: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    return readBoundedInput(fd, limit);
  } catch {
    throw new Error(message);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export async function runRuntimeCommand({
  positionals,
  options,
  stdout,
  readStdin,
  dependencies = {},
}: {
  positionals: string[];
  options: CommandOptions;
  stdout: CommandOutput;
  readStdin?: () => string | Promise<string>;
  dependencies?: RuntimeDependencies;
}): Promise<void> {
  const [, command, taskId, ...rest] = positionals;
  if (
    !["start", "complete", "key-import"].includes(command) ||
    (command === "key-import" ? taskId !== undefined : !taskId) ||
    rest.length
  ) {
    throw new Error(
      "Use runtime start or complete with TASK_ID; key-import takes no Task ID",
    );
  }
  const commandOptions = command === "complete" ? COMPLETE_OPTIONS : NO_OPTIONS;
  for (const name of Object.keys(options)) {
    if (
      (!COMMON_OPTIONS.has(name) && !commandOptions.has(name)) ||
      (command === "key-import" && name === "organization-id")
    ) {
      throw new Error(
        `runtime ${command} does not accept --${name}; runtime uses Preprod only`,
      );
    }
  }
  if (command === "key-import" && options["api-key-stdin"] !== true) {
    throw new Error(
      "runtime key-import requires --api-key-stdin with a coworker_* key",
    );
  }
  const coworkerId = requiredOption(options, "coworker-id");
  const organizationId =
    command === "key-import" ? "" : requiredOption(options, "organization-id");
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  let apiKey: string | undefined;
  try {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(900_000),
    ]);
    const resultText =
      command === "complete"
        ? readRuntimeFile(
            requiredOption(options, "result-file"),
            1_048_576,
            "Result file must contain UTF-8 text of at most 1 MiB",
          )
        : undefined;
    if (resultText !== undefined && !resultText.trim())
      throw new Error("Result file must not be empty");
    if (options["api-key-stdin"] === true) {
      if (!readStdin && process.stdin.isTTY) {
        throw new Error(
          "Pipe a Coworker key into stdin; do not put secrets in command arguments",
        );
      }
      apiKey = parseRuntimeKeyInput(
        await (readStdin
          ? readStdin()
          : readRuntimeStdin(
              AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
            )),
        coworkerId,
      );
    } else {
      apiKey = readRuntimeCredential(coworkerId, dependencies.credentialStore);
    }
    const client = createCoworkerHttpClient({
      apiKey,
      fetchImpl: dependencies.fetchImpl,
    });
    if (resultText?.includes(apiKey)) {
      throw new Error(
        "Task result contains the runtime credential. No result was submitted.",
      );
    }
    if (command === "key-import") {
      const response = record(await client.get("/v1/coworkers/me", signal));
      const coworker = record(response.data);
      if (
        coworker.id !== coworkerId ||
        coworker.archivedAt !== null ||
        !Array.isArray(coworker.capabilities) ||
        !coworker.capabilities.includes("tasks")
      ) {
        throw new Error(
          "Runtime key must identify the requested active Coworker with Task capability",
        );
      }
      saveRuntimeCredential(coworkerId, apiKey, dependencies.credentialStore);
      if (options.json)
        writeJson(
          stdout,
          redactSensitive({ coworkerId, stored: true }, [apiKey]),
        );
      else
        stdout.write(
          redactErrorMessage(
            `Stored the Preprod runtime key for Coworker ${coworkerId} in the OS vault.\n`,
            [apiKey],
          ),
        );
      return;
    }
    const context = { client, coworkerId, organizationId, taskId, signal };
    if (command === "start") {
      const task = await startRuntimeTask(context);
      if (options.json) writeJson(stdout, redactSensitive(task, [apiKey]));
      else
        stdout.write(
          redactErrorMessage(
            `Task ${task.id} is RUNNING.\n${task.name}\n${task.description ?? ""}\n`,
            [apiKey],
          ),
        );
      return;
    }
    if (resultText === undefined)
      throw new Error("runtime complete requires --result-file");
    const result = await completeRuntimeTask({
      ...context,
      result: resultText,
    });
    const safeResult = redactSensitive(result, [apiKey]);
    if (options.json) writeJson(stdout, safeResult);
    else {
      const message = `Task ${result.taskId} completed. Event: ${result.eventId}\n`;
      stdout.write(redactErrorMessage(message, [apiKey]));
    }
  } catch (error) {
    throw new Error(redactErrorMessage(error, apiKey ? [apiKey] : []));
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
