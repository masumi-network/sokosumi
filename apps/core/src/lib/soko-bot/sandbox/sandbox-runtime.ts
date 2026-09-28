import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  IndexedRuntimeEvent,
  RuntimeCancelInput,
  RuntimeEventStreamInput,
  RuntimeHealth,
  RuntimeInspectInput,
  RuntimeResetInput,
  RuntimeTurnInput,
  RuntimeTurnRef,
  SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import type { NetworkPolicy } from "@vercel/sandbox";
import { Sandbox } from "@vercel/sandbox";
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
  closeTurn,
  failTurn,
  RuntimeEventLog,
  runtimeEvent,
} from "@/lib/soko-bot/turn-loop";
import { issueTurnToken, TURN_TOKEN_HEADER } from "./turn-token";

/** Where the runner lives in the sandbox, outside the bot's workspace. */
const RUNNER_DIR = "/vercel/sandbox/.soko-bot";
const RUNNER_PATH = `${RUNNER_DIR}/runner.mjs`;
export const SANDBOX_WORKSPACE = "/vercel/sandbox/workspace";

/** How long a sandbox session stays up without a turn before it parks. */
const SESSION_TIMEOUT_MS = 20 * 60 * 1_000;

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

export function sandboxName(sokoBotId: string): string {
  return `soko-bot-${sokoBotId}`;
}

function credentials(): Record<string, string> {
  const env = getEnv();
  // On Vercel the function's OIDC token authorizes sandbox creation; outside
  // it (local development) all three must be supplied explicitly.
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

let runnerSource: Promise<{ content: Buffer; sha256: string }> | null = null;

/**
 * The bundled runner, built beside Core (`dist/soko-bot-runner.mjs`). Read
 * once per instance; its hash is how a launch notices a tampered copy.
 */
function loadRunner(): Promise<{ content: Buffer; sha256: string }> {
  runnerSource ??= (async () => {
    const candidates = [
      new URL("./soko-bot-runner.mjs", import.meta.url),
      path.join(process.cwd(), "dist/soko-bot-runner.mjs"),
      path.join(process.cwd(), "apps/core/dist/soko-bot-runner.mjs"),
    ];
    for (const candidate of candidates) {
      try {
        const content = await readFile(candidate);
        return {
          content,
          sha256: createHash("sha256").update(content).digest("hex"),
        };
      } catch {
        // Try the next location.
      }
    }
    runnerSource = null;
    throw new Error(
      "Soko Bot runner bundle not found; run `pnpm --filter @sokosumi/core build`",
    );
  })();
  return runnerSource;
}

/**
 * Open internet for research, nothing inside our network, and requests to this
 * turn's Core endpoints carry its token — added by the proxy, so no process in
 * the sandbox ever holds it.
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
          transform: [{ headers: { [TURN_TOKEN_HEADER]: token } }],
        },
      ],
      "*": [],
    },
    subnets: { deny: DENIED_SUBNETS },
  };
}

async function openBotSandbox(sokoBotId: string): Promise<Sandbox> {
  const env = getEnv();
  return Sandbox.getOrCreate({
    ...credentials(),
    name: sandboxName(sokoBotId),
    persistent: true,
    region: env.SOKO_BOT_SANDBOX_REGION,
    resources: { vcpus: env.SOKO_BOT_SANDBOX_VCPUS },
    timeout: SESSION_TIMEOUT_MS,
    tags: { app: "soko-bot" },
    // Deny until the first turn sets its own policy.
    networkPolicy: "deny-all",
  } as Parameters<typeof Sandbox.getOrCreate>[0]);
}

/** Rewrites the runner unless the sandbox copy is byte-for-byte ours. */
async function ensureRunner(sandbox: Sandbox): Promise<void> {
  const runner = await loadRunner();
  const current = await sandbox
    .readFileToBuffer({ path: RUNNER_PATH })
    .catch(() => null);
  if (
    current &&
    createHash("sha256").update(current).digest("hex") === runner.sha256
  )
    return;
  await sandbox.runCommand("mkdir", ["-p", RUNNER_DIR, SANDBOX_WORKSPACE]);
  await sandbox.writeFiles([{ path: RUNNER_PATH, content: runner.content }]);
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
    const sandbox = await openBotSandbox(input.sokoBotId);
    await sandbox.updateNetworkPolicy(networkPolicy(input.turnId, token));
    await sandbox
      .extendTimeout(
        Math.max(60_000, turn.deadlineAt.getTime() - Date.now() + 60_000),
      )
      .catch(() => undefined);
    await ensureRunner(sandbox);
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
    await log
      .append(runtimeEvent("session.started", { sessionId }))
      .then(() =>
        log.append(runtimeEvent("turn.started", { turnId: input.turnId })),
      )
      .then(() =>
        log.append(
          runtimeEvent("message.received", { message: input.message }),
        ),
      )
      .catch(() => undefined);
    await failTurn(log, {
      code: "sandbox_launch_failed",
      message:
        error instanceof Error ? error.message : "Could not start the sandbox",
    });
    await closeTurn(log, input.turnId);
  }
}

/** Parks the bot's sandbox after a turn; its workspace persists. */
export async function stopBotSandbox(sokoBotId: string): Promise<void> {
  try {
    const sandbox = await Sandbox.get({
      ...credentials(),
      name: sandboxName(sokoBotId),
    } as Parameters<typeof Sandbox.get>[0]);
    await sandbox.updateNetworkPolicy("deny-all").catch(() => undefined);
    await sandbox.stop();
  } catch (error) {
    // The session times out on its own; a failed stop only costs idle minutes.
    console.warn("Soko Bot sandbox stop failed", {
      sokoBotId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Each bot's agent loop runs in its own persistent Vercel Sandbox: a Linux VM
 * with the web, a shell and a workspace that survives between turns. Core
 * starts the runner and serves it over `/v1/soko-bot-runtime`; turn state,
 * events and settlement are the same as for the in-process runtime.
 */
export class SandboxSokoBotRuntime implements SokoBotRuntime {
  async createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef> {
    const sessionId = input.sessionId ?? `sess_${randomUUID()}`;
    // The caller is answering a user; the sandbox starts in the background.
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

  // The runner sees the cancellation on its next call to Core and stops.
  cancelTurn(input: RuntimeCancelInput): Promise<void> {
    return cancelStoredTurn(input);
  }

  resetSession(input: RuntimeResetInput): Promise<void> {
    return resetStoredSession(input);
  }

  inspectSession(input: RuntimeInspectInput): Promise<RuntimeHealth> {
    return inspectStoredSession(input, SANDBOX_RUNTIME_VERSION);
  }
}
