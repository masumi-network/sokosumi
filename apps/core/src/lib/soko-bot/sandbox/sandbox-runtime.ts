import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  type IndexedRuntimeEvent,
  type RuntimeCancelInput,
  type RuntimeEventStreamInput,
  type RuntimeHealth,
  type RuntimeInspectInput,
  type RuntimeResetInput,
  type RuntimeTurnInput,
  type RuntimeTurnRef,
  SOKO_BOT_TURN_TOKEN_HEADER,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { Drive, type NetworkPolicy, Sandbox } from "@vercel/sandbox";
import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  cancelStoredTurn,
  inspectStoredSession,
  resetStoredSession,
  streamStoredEvents,
} from "@/lib/soko-bot/in-process-runtime";
import { SANDBOX_RUNTIME_VERSION } from "@/lib/soko-bot/runtime-version";
import {
  announceTurn,
  closeTurn,
  failTurn,
  RuntimeEventLog,
} from "@/lib/soko-bot/turn-loop";
import { issueTurnToken } from "./turn-token";

/** The runner lives on the VM's own disk, outside the bot's workspace. */
const RUNNER_PATH = "/vercel/sandbox/.soko-bot/runner.mjs";
/** Mount point of the bot's Drive: the only thing that outlives a turn. */
export const SANDBOX_WORKSPACE = "/vercel/sandbox/workspace";
const SANDBOX_IMAGE = "vercel/sandbox/universal";
/** EU: workspaces and VMs stay in Frankfurt, like the model routing. */
const SANDBOX_REGION = "fra1";
const SANDBOX_VCPUS = 2;

/**
 * Private and link-local ranges: nothing inside our infrastructure. The
 * sandbox firewall takes IPv4 CIDRs only (it rejects `fc00::/7`).
 */
const DENIED_SUBNETS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
];

export function turnSandboxName(turnId: string): string {
  return `soko-bot-turn-${turnId}`;
}

function workspaceDriveName(sokoBotId: string): string {
  return `soko-bot-${sokoBotId}`;
}

interface SandboxCredentials {
  token: string;
  teamId: string;
  projectId: string;
}

/**
 * On Vercel the function's OIDC token authorizes sandbox calls; outside it
 * (local development) all three must be supplied explicitly.
 */
function credentials(): SandboxCredentials | Record<never, never> {
  const env = getEnv();
  return env.VERCEL_SANDBOX_TOKEN &&
    env.VERCEL_SANDBOX_TEAM_ID &&
    env.VERCEL_SANDBOX_PROJECT_ID
    ? {
        token: env.VERCEL_SANDBOX_TOKEN,
        teamId: env.VERCEL_SANDBOX_TEAM_ID,
        projectId: env.VERCEL_SANDBOX_PROJECT_ID,
      }
    : {};
}

/** The public origin sandboxes call Core on. */
export function runtimePublicUrl(): string {
  return (
    getEnv().SOKO_BOT_RUNTIME_PUBLIC_URL ?? getBetterAuthPublicBaseUrl()
  ).replace(/\/$/, "");
}

let runnerSource: Promise<Buffer> | null = null;

/** The bundled runner, built beside Core as `dist/soko-bot-runner.mjs`. */
function loadRunner(): Promise<Buffer> {
  runnerSource ??= readFile(
    new URL("./soko-bot-runner.mjs", import.meta.url),
  ).catch(() => {
    // Development: Core runs from source; the runner is built into dist/.
    return readFile(
      new URL("../../../../dist/soko-bot-runner.mjs", import.meta.url),
    );
  });
  return runnerSource.catch((error) => {
    runnerSource = null;
    throw error;
  });
}

/**
 * Open internet for research, nothing inside our network, and requests to this
 * turn's Core endpoints carry its token — added by the proxy, so no process in
 * the VM ever holds it. The VM lives for this turn only.
 */
function networkPolicy(turnId: string, token: string): NetworkPolicy {
  const core = new URL(runtimePublicUrl());
  return {
    allow: {
      [core.hostname]: [
        {
          match: {
            path: { startsWith: `/v1/soko-bot-runtime/turns/${turnId}/` },
          },
          transform: [{ headers: { [SOKO_BOT_TURN_TOKEN_HEADER]: token } }],
        },
      ],
      "*": [],
    },
    subnets: { deny: DENIED_SUBNETS },
  };
}

/** Stops a turn's VM. A failed stop only costs the VM's remaining timeout. */
export async function stopTurnSandbox(turnId: string): Promise<void> {
  try {
    const sandbox = await Sandbox.get({
      ...credentials(),
      name: turnSandboxName(turnId),
    });
    await sandbox.stop();
  } catch (error) {
    console.warn("Soko Bot sandbox stop failed", {
      turnId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * The bot's persistent workspace. A Drive attaches to one VM at a time, so a
 * VM an earlier turn left running — crashed, cancelled, never stopped — is
 * stopped first; nothing a previous turn started survives into this one.
 */
async function workspaceDrive(sokoBotId: string): Promise<Drive> {
  const drive = await Drive.getOrCreate({
    ...credentials(),
    name: workspaceDriveName(sokoBotId),
    region: SANDBOX_REGION,
  });
  const holder = drive.currentSandboxName;
  if (holder) {
    const sandbox = await Sandbox.get({ ...credentials(), name: holder });
    await sandbox.stop();
  }
  return drive;
}

async function launch(sessionId: string, input: RuntimeTurnInput) {
  const log = new RuntimeEventLog(input.turnId, sessionId);
  try {
    const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
      where: { id: input.turnId },
      select: { deadlineAt: true },
    });
    const token = issueTurnToken({
      turnId: input.turnId,
      sessionId,
      expiresAt: turn.deadlineAt.getTime() + 60_000,
    });
    const drive = await workspaceDrive(input.sokoBotId);
    const sandbox = await Sandbox.create({
      ...credentials(),
      name: turnSandboxName(input.turnId),
      image: SANDBOX_IMAGE,
      region: SANDBOX_REGION,
      resources: { vcpus: SANDBOX_VCPUS },
      timeout: Math.max(
        60_000,
        turn.deadlineAt.getTime() - Date.now() + 60_000,
      ),
      networkPolicy: networkPolicy(input.turnId, token),
      mounts: { [SANDBOX_WORKSPACE]: drive },
      tags: { app: "soko-bot", bot: input.sokoBotId },
    });
    await sandbox.writeFiles([
      { path: RUNNER_PATH, content: await loadRunner() },
    ]);
    await sandbox.runCommand({
      cmd: "node",
      args: [RUNNER_PATH],
      cwd: SANDBOX_WORKSPACE,
      env: {
        SOKO_BOT_CORE_URL: runtimePublicUrl(),
        SOKO_BOT_TURN_ID: input.turnId,
      },
      detached: true,
    });
  } catch (error) {
    console.error("Soko Bot sandbox launch failed", {
      turnId: input.turnId,
      error: error instanceof Error ? error.message : "unknown",
    });
    // The drain binds a turn on `turn.started` + `message.received` and skips
    // anything before them, so a turn that failed before the runner started
    // has to announce itself first or it sits RUNNING until the watchdog.
    await announceTurn(log, input.message).catch(() => undefined);
    await failTurn(log, {
      code: "sandbox_launch_failed",
      message:
        error instanceof Error ? error.message : "Could not start the sandbox",
    });
    await closeTurn(log, input.turnId);
    await stopTurnSandbox(input.turnId);
  }
}

/**
 * Each turn runs in a fresh Vercel Sandbox VM with the bot's Drive mounted as
 * its workspace: the web, a shell and files that persist, and nothing else
 * that does. Core starts the runner and serves it over `/v1/soko-bot-runtime`;
 * turn state, events and settlement are shared with the in-process runtime.
 */
export class SandboxSokoBotRuntime implements SokoBotRuntime {
  async createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef> {
    const sessionId = input.sessionId ?? `sess_${randomUUID()}`;
    // The caller is answering a user; the VM starts in the background.
    waitUntil(launch(sessionId, input));
    return {
      sessionId,
      runtimeVersion: SANDBOX_RUNTIME_VERSION,
      acceptedAt: new Date().toISOString(),
    };
  }

  streamEvents(
    input: RuntimeEventStreamInput,
  ): AsyncIterable<IndexedRuntimeEvent> {
    return streamStoredEvents(input);
  }

  async cancelTurn(input: RuntimeCancelInput): Promise<void> {
    await cancelStoredTurn(input);
    // A cancelled runner exits on its next call to Core; stopping the VM also
    // ends anything it started.
    const turn = await prisma.sokoBotTurn.findFirst({
      where: { eveSessionId: input.sessionId },
      select: { id: true },
    });
    if (turn) waitUntil(stopTurnSandbox(turn.id));
  }

  resetSession(input: RuntimeResetInput): Promise<void> {
    return resetStoredSession(input);
  }

  inspectSession(input: RuntimeInspectInput): Promise<RuntimeHealth> {
    return inspectStoredSession(input, SANDBOX_RUNTIME_VERSION);
  }
}
