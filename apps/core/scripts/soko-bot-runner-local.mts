/**
 * Runs one Soko Bot turn with the real runner against a local Core, without a
 * sandbox or a tunnel: Core creates the turn, this script starts the runner
 * on this machine in a scratch workspace, and Core settles it.
 *
 *   tsx --env-file=.env scripts/soko-bot-runner-local.mts <userId> <workspaceId> "<message>"
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import prisma from "@/lib/db/prisma";
import { issueTurnToken } from "@/lib/soko-bot/sandbox/turn-token";
import { SokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const [userId, workspaceId, message] = process.argv.slice(2);
if (!userId || !workspaceId || !message) {
  console.error("usage: <userId> <workspaceId> <message>");
  process.exit(2);
}

let sessionId = "";
const manualRuntime = {
  async createSession(input: { sessionId: string | null }) {
    sessionId = input.sessionId ?? `sess_local_${Date.now()}`;
    return {
      sessionId,
      runtimeVersion: "local-runner",
      acceptedAt: new Date().toISOString(),
    };
  },
  async *streamEvents() {},
  async cancelTurn() {},
  async resetSession() {},
  async inspectSession() {
    return {
      healthy: true,
      runtimeVersion: "local-runner",
      sessionStatus: null,
    };
  },
};

const plane = new SokoBotControlPlane(manualRuntime as never);
const started = await plane.startTurn({
  userId,
  workspaceId,
  clientTurnId: `local-runner:${Date.now()}`,
  message,
});
const turn = await prisma.sokoBotTurn.findUniqueOrThrow({
  where: { id: started.turnId },
  select: { deadlineAt: true, route: true, capabilityNames: true },
});
console.log(
  JSON.stringify({
    turnId: started.turnId,
    route: turn.route,
    sandboxTools: turn.capabilityNames.filter((c) =>
      ["bash", "web_search", "workspace_write"].includes(c),
    ),
  }),
);

const workspace = await mkdtemp(path.join(tmpdir(), "soko-bot-workspace-"));
const exitCode = await new Promise<number | null>((resolve) => {
  const child = spawn("node", [path.resolve("dist/soko-bot-runner.mjs")], {
    cwd: workspace,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SOKO_BOT_CORE_URL: process.env.LOCAL_CORE_URL ?? "http://localhost:3001",
      SOKO_BOT_TURN_ID: started.turnId,
      SOKO_BOT_TURN_TOKEN: issueTurnToken({
        turnId: started.turnId,
        sessionId,
        expiresAt: turn.deadlineAt.getTime(),
      }),
    },
  });
  child.on("close", resolve);
});
console.log(JSON.stringify({ runnerExit: exitCode, workspace }));
await prisma.$disconnect();
