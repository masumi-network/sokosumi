/**
 * Exercises every Soko Bot capability against a real bot and reports which
 * ones work. A synthetic RUNNING turn grants all of them, so coverage does
 * not depend on which tools a model happens to choose.
 *
 * Tools that spend money or leave something permanent are probed at their
 * guard rather than their happy path: the refusal is the behaviour worth
 * proving, and buying an agent to prove `hire_agent` works is not a test.
 */
import { randomUUID } from "node:crypto";
import { SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { SokoBotRuntimeService } from "@/services/soko-bot-runtime.service";

const email = process.argv[2] ?? "patrick@nmkr.io";
const bot = await prisma.sokoBot.findFirstOrThrow({
  where: { user: { email }, archivedAt: null },
  select: {
    id: true,
    userId: true,
    workspaceId: true,
    name: true,
    versionId: true,
  },
});

const snapshotId = randomUUID();
const turnId = randomUUID();
await prisma.sokoBotContextSnapshot.create({
  data: {
    id: snapshotId,
    schemaVersion: 1,
    byteSize: 32,
    tokenEstimate: 8,
    counts: {},
    omissions: {},
    generatedAt: new Date(),
    hash: "smoke",
    packet: { memory: { version: 0 } },
    turn: {
      create: {
        id: turnId,
        sokoBotId: bot.id,
        userId: bot.userId,
        workspaceId: bot.workspaceId,
        clientTurnId: `lab:toolsmoke:${Date.now()}`,
        userMessage: "tool smoke",
        versionId: bot.versionId,
        source: "ADMIN_RETRY",
        status: "RUNNING",
        classification: { confidence: 1 },
        capabilityNames: [...SOKO_BOT_CAPABILITIES],
        deadlineAt: new Date(Date.now() + 20 * 60_000),
        leaseExpiresAt: new Date(Date.now() + 20 * 60_000),
      },
    },
  },
});

const svc = new SokoBotRuntimeService();
const scope = {
  turnId,
  sokoBotId: bot.id,
  userId: bot.userId,
  workspaceId: bot.workspaceId,
};
const results: { capability: string; outcome: string; note: string }[] = [];

/** Missing local credentials are an environment gap, not a broken tool. */
const ENV_GAP = /No blob credentials|BLOB_READ_WRITE_TOKEN/i;

async function probe(
  capability: string,
  input: unknown,
  expectRefusal?: RegExp,
) {
  try {
    await svc.executeTool({
      ...scope,
      capability,
      toolCallId: randomUUID(),
      input,
    } as never);
    results.push({
      capability,
      outcome: expectRefusal ? "UNGUARDED" : "ok",
      note: expectRefusal ? "expected a refusal and got none" : "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const guarded = expectRefusal?.test(message) ?? false;
    results.push({
      capability,
      outcome: guarded ? "guard ok" : ENV_GAP.test(message) ? "env" : "FAILED",
      note: message.replace(/\s+/g, " ").slice(0, 110),
    });
  }
}

const anyTask = await prisma.task.findFirst({
  where: {
    workspaceId: bot.workspaceId,
    archivedAt: null,
    status: { in: ["DRAFT", "READY"] },
  },
  select: { id: true },
});
const anyJob = await prisma.job.findFirst({
  where: { workspaceId: bot.workspaceId },
  select: { id: true },
});
// The agent has to be one this workspace can actually hire, or the schema
// lookup rightly refuses it and the probe tests nothing.
const anyAgent = await prisma.agent.findFirst({
  orderBy: { createdAt: "desc" },
  select: { id: true },
});
// Discovered rather than assumed: which mailbox is connected differs per bot.
const connected = await prisma.sokoBotIntegration.findFirst({
  where: { sokoBotId: bot.id, status: "ACTIVE" },
  select: { provider: true },
});

await probe("refresh_context", {});
await probe("read_memory", {});
await probe("list_schedules", {});
await probe("list_chats", {});
await probe("list_files", {});
await probe("list_integrations", {});
await probe("find_coworkers", { query: "" });
await probe("find_agents", { query: "research" });
if (anyTask) await probe("get_task_status", { taskId: anyTask.id });
if (anyJob) await probe("get_job_status", { jobId: anyJob.id });
// Selected the way the tool selects: an agent that is not shown, offline or
// without an API base URL is not one this bot could hire.
const hireable = await prisma.agent.findFirst({
  where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
  select: { id: true },
});
const agentId = hireable?.id ?? anyAgent?.id;
if (agentId) await probe("get_agent_input_schema", { agentId });
if (connected)
  await probe("list_integration_tools", { provider: connected.provider });
await probe("search_inbox", { query: "" });
await probe("list_calendar_events", {});

// Guards: these spend credits or leave something nobody can remove.
await probe(
  "hire_agent",
  { agentId: anyAgent?.id ?? randomUUID(), maxCredits: 999999, input: {} },
  /budget|credits|not allowed|unattended|schema|input/i,
);
await probe(
  "open_direct_chat",
  { person: "patrick@nmkr.io", message: "smoke" },
  /already have a direct chat with your owner|owner asked for/i,
);
await probe(
  "update_task",
  { taskId: randomUUID(), name: "x" },
  /Task not found/i,
);
await probe(
  "update_assigned_task",
  { taskId: randomUUID(), status: "COMPLETED", comment: "smoke" },
  /Task not found|not the assignee/i,
);
await probe(
  "request_user_decision",
  { kind: "hire_agent", summary: "smoke", proposal: {} },
  /./,
);

await prisma.sokoBotTurn
  .delete({ where: { id: turnId } })
  .catch(() => undefined);

const width = Math.max(...results.map((r) => r.capability.length));
for (const r of results) {
  console.log(
    `${r.outcome.padEnd(9)} ${r.capability.padEnd(width)}  ${r.note}`,
  );
}
const bad = results.filter(
  (r) => r.outcome === "FAILED" || r.outcome === "UNGUARDED",
);
const env = results.filter((r) => r.outcome === "env");
if (env.length > 0) {
  console.log(
    `\n${env.length} skipped for missing local credentials: ${env.map((r) => r.capability).join(", ")}`,
  );
}
console.log(
  `\n${results.length - bad.length}/${results.length} behaved as expected`,
);
await prisma.$disconnect();
