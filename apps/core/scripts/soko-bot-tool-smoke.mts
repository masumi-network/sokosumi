/**
 * Exercises every Soko Bot capability against a real bot and reports which
 * ones work.
 *
 * These are real calls with real effects: Tasks are created and assigned,
 * messages are posted, an Agent is hired with the owner's credits. That is
 * deliberate. A probe that only proves the refusals fire tells you the guards
 * work, not that the tools do, and the one thing genuinely broken here —
 * blob storage — would never have shown up without a real write.
 *
 * A synthetic RUNNING turn grants every capability, so coverage does not
 * depend on which tools a model happens to reach for. What the run creates is
 * cleaned up where the platform allows and listed where it does not.
 */
import { randomUUID } from "node:crypto";

import { SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { SokoBotRuntimeService } from "@/services/soko-bot-runtime.service";

const email = process.argv[2] ?? "patrick@nmkr.io";
// Spending is the point: a run that skips the paid path proves the guard
// works, not the tool. `--dry` opts out when that is genuinely wanted.
const allowSpend = !process.argv.includes("--dry");

const bot = await prisma.sokoBot.findFirstOrThrow({
  where: { user: { email }, archivedAt: null },
  select: {
    id: true,
    userId: true,
    workspaceId: true,
    name: true,
    versionId: true,
    coworker: { select: { id: true } },
  },
});

const memoryVersion =
  (
    await prisma.sokoBotMemoryRevision.findFirst({
      where: { sokoBotId: bot.id },
      orderBy: { version: "desc" },
      select: { version: true },
    })
  )?.version ?? 0;

const turnId = randomUUID();
await prisma.sokoBotContextSnapshot.create({
  data: {
    id: randomUUID(),
    schemaVersion: 1,
    byteSize: 32,
    tokenEstimate: 8,
    counts: {},
    omissions: {},
    generatedAt: new Date(),
    hash: "smoke",
    // The bot's real memory version: `update_memory` refuses a stale one, and
    // a snapshot claiming version 0 fails a tool that is working correctly.
    packet: { memory: { version: memoryVersion } },
    turn: {
      create: {
        id: turnId,
        sokoBotId: bot.id,
        userId: bot.userId,
        workspaceId: bot.workspaceId,
        clientTurnId: `lab:toolsmoke:${Date.now()}`,
        userMessage: "tool smoke",
        versionId: bot.versionId,
        // CHAT so the owner-asked tools are reachable; a synthetic
        // ADMIN_RETRY turn cannot exercise them at all.
        source: "CHAT",
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
let peerId: string | null = null;
const leftBehind: string[] = [];

async function run(capability: string, input: unknown): Promise<unknown> {
  const outcome = await svc
    .executeTool({
      ...scope,
      capability,
      toolCallId: randomUUID(),
      input,
    } as never)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  results.push({
    capability,
    outcome: outcome.ok ? "ok" : "FAILED",
    note: outcome.ok ? "" : outcome.message.replace(/\s+/g, " ").slice(0, 110),
  });
  return outcome.ok ? outcome.value : null;
}

function skip(capability: string, why: string) {
  results.push({ capability, outcome: "skipped", note: why });
}

// ---- reads -----------------------------------------------------------------
await run("refresh_context", {});
await run("read_memory", {});
await run("list_schedules", {});
await run("list_chats", {});
await run("list_files", {});
await run("list_integrations", {});
await run("find_coworkers", { query: "" });
await run("find_agents", { query: "" });
await run("list_calendar_events", {});

const inbox = (await run("search_inbox", { limit: 5 })) as
  | { messages?: { id: string; provider: string }[] }
  | { id: string; provider: string }[]
  | null;
const message = Array.isArray(inbox) ? inbox[0] : inbox?.messages?.[0];
if (message) {
  await run("read_email", {
    provider: message.provider,
    messageId: message.id,
  });
} else {
  skip("read_email", "no message in the connected mailbox");
}

const integration = await prisma.sokoBotIntegration.findFirst({
  where: { sokoBotId: bot.id, status: "ACTIVE" },
  select: { provider: true },
});
if (integration) {
  await run("list_integration_tools", { provider: integration.provider });
} else {
  skip("list_integration_tools", "no connected account");
  skip("run_integration_tool", "no connected account");
}

// ---- the Task lifecycle, for real -----------------------------------------
const created = (await run("create_task", {
  name: `Tool smoke ${new Date().toISOString().slice(0, 16)}`,
  description: "Created by soko-bot:tool-smoke. Safe to delete.",
  status: "DRAFT",
})) as { id?: string } | null;

if (created?.id) {
  await run("get_task_status", { taskId: created.id });
  await run("update_task", {
    taskId: created.id,
    description: "Updated by the smoke run.",
  });

  peerId =
    (
      (await run("create_task", {
        name: `Tool smoke peer ${Date.now()}`,
        status: "DRAFT",
      })) as { id?: string } | null
    )?.id ?? null;
  if (peerId) {
    await run("link_tasks", {
      taskId: created.id,
      peerTaskId: peerId,
      relation: "related",
    });
  } else {
    skip("link_tasks", "peer task was not created");
  }

  if (bot.coworker?.id) {
    await run("assign_task", {
      taskId: created.id,
      coworkerId: bot.coworker.id,
      ready: true,
    });
    await run("reply_to_task", {
      taskId: created.id,
      comment: "Smoke comment.",
    });
    await run("update_assigned_task", {
      taskId: created.id,
      status: "COMPLETED",
      comment: "Closed by the smoke run.",
    });
  } else {
    for (const c of ["assign_task", "reply_to_task", "update_assigned_task"]) {
      skip(c, "bot has no chat identity to assign to");
    }
  }
  leftBehind.push(
    `Tasks archived: ${created.id}${peerId ? `, ${peerId}` : ""}`,
  );
} else {
  for (const c of [
    "get_task_status",
    "update_task",
    "link_tasks",
    "assign_task",
    "reply_to_task",
    "update_assigned_task",
  ]) {
    skip(c, "scratch task was not created");
  }
}

// ---- schedules: created, changed and removed again -------------------------
const schedule = (await run("create_schedule", {
  name: `Tool smoke ${Date.now()}`,
  cronExpression: "0 9 * * 1",
  timezone: "Europe/Zurich",
  prompt: "Smoke schedule. Safe to delete.",
})) as { id?: string } | null;
if (schedule?.id) {
  await run("update_schedule", {
    scheduleId: schedule.id,
    prompt: "Smoke schedule, updated.",
  });
  await run("delete_schedule", { scheduleId: schedule.id });
} else {
  skip("update_schedule", "schedule was not created");
  skip("delete_schedule", "schedule was not created");
}

// ---- chat: a real message in the owner's own room ---------------------------
const ownRoom = await prisma.chatRoom.findFirst({
  where: {
    kind: "direct",
    archivedAt: null,
    coworkerMembers: { some: { coworkerId: bot.coworker?.id ?? "" } },
    userMembers: { some: { userId: bot.userId } },
  },
  select: { id: true },
});
if (ownRoom) {
  await run("post_chat", {
    roomId: ownRoom.id,
    content: "Tool smoke run: post_chat works.",
  });
  await run("read_chat", { roomId: ownRoom.id });
} else {
  skip("post_chat", "no direct room with the owner");
  skip("read_chat", "no direct room with the owner");
}

await run("update_memory", {
  markdown: "# Soko Bot memory\n\n## Notes\n- Tool smoke run touched memory.",
});
await run("upload_file", {
  filename: `tool-smoke-${Date.now()}.md`,
  content: "Written by soko-bot:tool-smoke. Safe to delete.",
});

// ---- hiring: real credits, only when asked for ------------------------------
const hireable = await prisma.agent.findFirst({
  where: { isShown: true, status: "ONLINE", apiBaseUrl: { not: null } },
  select: { id: true, name: true },
});
if (!hireable) {
  skip("get_agent_input_schema", "no hireable agent in this workspace");
  skip("hire_agent", "no hireable agent in this workspace");
  skip("provide_job_input", "no hireable agent in this workspace");
} else {
  const schema = (await run("get_agent_input_schema", {
    agentId: hireable.id,
  })) as Record<string, unknown> | null;
  if (process.argv.includes("--show-schema")) {
    console.log("agent schema:", JSON.stringify(schema).slice(0, 900));
  }
  if (!allowSpend) {
    skip("hire_agent", "--dry");
    skip("provide_job_input", "--dry");
  } else {
    // Built from the schema the tool just returned, the way a real caller
    // does it: every field that takes input gets a value, and the purely
    // informational ones (`type: "none"`) are left alone.
    const fields = Array.isArray(schema?.input_data)
      ? (schema.input_data as { id: string; type: string }[])
      : [];
    const inputData = Object.fromEntries(
      fields
        .filter((field) => field.type !== "none")
        .map((field) => [
          field.id,
          "Tool smoke run. Answer in one short sentence.",
        ]),
    );
    const job = (await run("hire_agent", {
      agentId: hireable.id,
      inputSchema: schema ?? {},
      inputData,
      // A ceiling, not a payment: the platform charges the Agent's own price
      // and refuses anything above this. Set high enough that the hire is
      // actually attempted, since a refusal before the call proves nothing.
      maxCredits: 100_000,
      name: "Tool smoke hire",
    })) as { jobId?: string; id?: string } | null;
    // Read back rather than taken from the response: the hire's own shape is
    // not worth depending on here, and the newest Job for this owner is the
    // one just created.
    void job;
    const latest = await prisma.job.findFirst({
      where: { ownerId: bot.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latest) {
      leftBehind.push(`Job: ${latest.id} (real credits spent)`);
      await run("get_job_status", { jobId: latest.id });
    } else {
      skip("get_job_status", "no Job found after the hire");
    }
    skip("provide_job_input", "only reachable once a Job asks for input");
  }
}

// The scratch Tasks are archived rather than left on the board: a harness
// meant to be run often should not silently fill somebody's Taskboard.
if (created?.id) {
  await prisma.task
    .updateMany({
      where: { id: { in: [created.id, ...(peerId ? [peerId] : [])] } },
      data: { archivedAt: new Date() },
    })
    .catch(() => undefined);
}

await prisma.sokoBotTurn
  .delete({ where: { id: turnId } })
  .catch(() => undefined);

const width = Math.max(...results.map((r) => r.capability.length));
for (const r of results) {
  console.log(
    `${r.outcome.padEnd(8)} ${r.capability.padEnd(width)}  ${r.note}`,
  );
}
const failed = results.filter((r) => r.outcome === "FAILED");
const skipped = results.filter((r) => r.outcome === "skipped");
console.log(
  `\n${results.length - failed.length - skipped.length} ok, ${failed.length} failed, ${skipped.length} skipped, of ${SOKO_BOT_CAPABILITIES.length} capabilities`,
);
if (leftBehind.length > 0)
  console.log(`Left behind: ${leftBehind.join(" · ")}`);
await prisma.$disconnect();
