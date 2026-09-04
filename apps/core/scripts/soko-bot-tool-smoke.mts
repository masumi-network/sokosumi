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

import {
  SOKO_BOT_CAPABILITIES,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { SokoBotRuntimeService } from "@/services/soko-bot-runtime.service";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

// No default owner. This posts messages, rewrites memory and can spend real
// credits, so whose bot it runs against is stated on every invocation rather
// than inherited from whoever wrote the script.
const email = flag("--owner");
if (!email) {
  console.error(
    "Usage: soko-bot:tool-smoke --owner <email> [--bot <id>] [--spend]\n" +
      "  --spend  also hire an Agent for real, with the owner's credits.",
  );
  process.exit(2);
}
// Spending is opt-in. Everything else here is reversible or scoped to the
// bot's own account; a hire is not, so it is asked for explicitly.
const allowSpend = process.argv.includes("--spend");

const botId = flag("--bot");
const candidates = await prisma.sokoBot.findMany({
  where: { user: { email }, archivedAt: null, ...(botId ? { id: botId } : {}) },
  select: {
    id: true,
    userId: true,
    workspaceId: true,
    name: true,
    versionId: true,
    coworker: { select: { id: true } },
  },
});
if (candidates.length === 0) {
  console.error(
    `No active Soko Bot for ${email}${botId ? ` with id ${botId}` : ""}.`,
  );
  process.exit(2);
}
// An owner with several workspaces has several bots, and picking one for them
// would run a real hire against a workspace nobody named.
if (candidates.length > 1) {
  console.error(
    `${email} has ${candidates.length} active bots. Pass --bot <id>:\n` +
      candidates
        .map((c) => `  ${c.id}  ${c.name} (workspace ${c.workspaceId})`)
        .join("\n"),
  );
  process.exit(2);
}
const bot = candidates[0];

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

// Filled in as the run creates them, so an interrupt can clean up the same
// things the happy path does rather than only the turn.
const scratchTaskIds: string[] = [];
// A schedule the run leaves behind does not just sit there: it fires, and the
// bot starts a turn nobody asked for.
let scratchScheduleId: string | null = null;

// The turn is RUNNING while this script holds it, and `startTurn` refuses to
// begin anything while one is active. A crash between here and the delete
// below would wedge the bot until somebody noticed, so cleanup is in a finally
// rather than at the end of the happy path.
//
// Failures are reported, not swallowed: a turn that could not be deleted
// blocks the bot's next real turn, and a run that exits 0 after that would
// leave nobody to notice.
async function cleanUp(): Promise<boolean> {
  let clean = true;
  if (scratchScheduleId) {
    await prisma.sokoBotSchedule
      .deleteMany({ where: { id: scratchScheduleId } })
      .catch((error: unknown) => {
        clean = false;
        console.error(
          `Smoke schedule ${scratchScheduleId} still fires: ${String(error)}`,
        );
      });
  }
  if (scratchTaskIds.length > 0) {
    await prisma.task
      .updateMany({
        where: { id: { in: scratchTaskIds } },
        data: { archivedAt: new Date() },
      })
      .catch((error: unknown) => {
        clean = false;
        console.error(`Scratch Tasks left on the board: ${String(error)}`);
      });
  }
  await prisma.sokoBotPendingDecision
    .deleteMany({ where: { turnId } })
    .catch((error: unknown) => {
      clean = false;
      console.error(`Pending decision left for the owner: ${String(error)}`);
    });
  await prisma.sokoBotTurn
    .delete({ where: { id: turnId } })
    .catch((error: unknown) => {
      clean = false;
      console.error(
        `Turn ${turnId} is still RUNNING and blocks this bot: ${String(error)}`,
      );
    });
  return clean;
}
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, async (error: unknown) => {
    await cleanUp();
    console.error(error);
    process.exit(1);
  });
}
// Ctrl-C is the likeliest way this run ends early, and the default handler
// would leave the synthetic turn RUNNING, the bot unable to start another, and
// the scratch Tasks sitting on the owner's board.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await cleanUp();
    process.exit(130);
  });
}

let failedRun = false;
try {
  const svc = new SokoBotRuntimeService();
  // What `authorize` actually takes. The turn carries the bot, owner and
  // workspace already, and the session is bound to the turn on first use the
  // same way a real run binds it.
  const scope = { turnId, sessionId: `toolsmoke:${turnId}` };
  // Keyed by capability rather than appended: `create_task` runs twice (the
  // task and its link peer), and two rows would make the tally read as more
  // coverage than there is.
  const results = new Map<string, { outcome: string; note: string }>();
  let peerId: string | null = null;
  const leftBehind: string[] = [];

  async function run(capability: string, input: unknown): Promise<unknown> {
    const outcome = await svc
      .executeTool({
        ...scope,
        capability: capability as SokoBotCapability,
        toolCallId: randomUUID(),
        input,
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({
          ok: false as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    results.set(capability, {
      outcome: outcome.ok ? "ok" : "FAILED",
      note: outcome.ok
        ? ""
        : outcome.message.replace(/\s+/g, " ").slice(0, 110),
    });
    return outcome.ok ? outcome.value : null;
  }

  function skip(capability: string, why: string) {
    results.set(capability, { outcome: "skipped", note: why });
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

  // Mailboxes and calendars have their own readers; `list_integration_tools`
  // is for the generic providers, and handing it Gmail is what its own error
  // message tells you not to do.
  const MAILBOX_OR_CALENDAR = new Set([
    "gmail",
    "outlook",
    "googlecalendar",
    "outlookcalendar",
  ]);
  const generic = await prisma.sokoBotIntegration.findFirst({
    where: {
      sokoBotId: bot.id,
      status: "ACTIVE",
      provider: { notIn: [...MAILBOX_OR_CALENDAR] },
    },
    select: { provider: true },
  });
  if (generic) {
    const tools = (await run("list_integration_tools", {
      provider: generic.provider,
    })) as {
      tools?: {
        slug: string;
        inputSchema?: { required?: string[] };
      }[];
    } | null;
    // Named on the command line, never chosen here. A slug is not a contract:
    // SEARCH_AND_ARCHIVE reads as a read and archives somebody's real mail, and
    // no naming rule this script could apply separates the two. Whoever runs it
    // picks a tool they have looked at.
    const named = flag("--integration-tool");
    const listed = tools?.tools?.some((tool) => tool.slug === named);
    if (named && listed) {
      await run("run_integration_tool", {
        provider: generic.provider,
        tool: named,
        arguments: JSON.parse(flag("--integration-args") ?? "{}"),
      });
    } else if (named) {
      skip(
        "run_integration_tool",
        `${named} is not a ${generic.provider} tool`,
      );
    } else {
      skip(
        "run_integration_tool",
        `acts on the real ${generic.provider} account; pass --integration-tool <slug> [--integration-args '{...}']`,
      );
    }
  } else {
    const why = "only a mailbox and calendar are connected";
    skip("list_integration_tools", why);
    skip("run_integration_tool", why);
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

    if (bot.id) {
      await run("assign_task", {
        taskId: created.id,
        coworkerId: bot.id,
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
      for (const c of [
        "assign_task",
        "reply_to_task",
        "update_assigned_task",
      ]) {
        skip(c, "bot has no sokoBot identity to assign to");
      }
    }
    scratchTaskIds.push(created.id, ...(peerId ? [peerId] : []));
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
    scratchScheduleId = schedule.id;
    await run("update_schedule", {
      scheduleId: schedule.id,
      prompt: "Smoke schedule, updated.",
    });
    await run("delete_schedule", { scheduleId: schedule.id });
    if (results.get("delete_schedule")?.outcome === "ok") {
      scratchScheduleId = null;
    }
  } else {
    skip("update_schedule", "schedule was not created");
    skip("delete_schedule", "schedule was not created");
  }

  // ---- chat: a real message in the owner's own room ---------------------------
  const ownRoom = await prisma.chatRoom.findFirst({
    where: {
      kind: "direct",
      archivedAt: null,
      orchestratorMembers: { some: { sokoBotId: bot.id } },
      userMembers: { some: { userId: bot.userId } },
    },
    select: { id: true },
  });
  if (ownRoom) {
    await run("post_chat", {
      roomId: ownRoom.id,
      content: "Tool smoke run: post_chat works.",
    });
    if (results.get("post_chat")?.outcome === "ok") {
      leftBehind.push(`Message in the owner's own chat (room ${ownRoom.id})`);
    }
    await run("read_chat", { roomId: ownRoom.id });
  } else {
    skip("post_chat", "no direct room with the owner");
    skip("read_chat", "no direct room with the owner");
  }

  // Memory is the bot's whole working state and `update_memory` replaces the
  // document rather than appending to it, so the run writes back exactly what
  // it read. A failed read is not an empty memory: `run` returns null for both,
  // and treating them alike would overwrite a real document with a blank one
  // and then "restore" the blank.
  const currentMemory = (await run("read_memory", {})) as {
    markdown?: string;
  } | null;
  const originalMarkdown = currentMemory?.markdown;
  if (typeof originalMarkdown !== "string") {
    skip("update_memory", "memory could not be read; refusing to overwrite it");
  } else {
    // A heading the parser keeps, not an HTML comment it strips: a marker that
    // does not survive the round trip proves nothing was written.
    await run("update_memory", {
      markdown: `${originalMarkdown}\n\n## Tool smoke\n- Written by soko-bot:tool-smoke and removed again.`,
    });
    if (results.get("update_memory")?.outcome === "ok") {
      const restored = await svc
        .executeTool({
          ...scope,
          capability: "update_memory",
          toolCallId: randomUUID(),
          input: { markdown: originalMarkdown },
        })
        .then(
          () => true,
          () => false,
        );
      if (!restored) {
        // Not just a note at the bottom of the output: the bot's next real
        // turn would start from the harness's document, and a run that exits
        // 0 says nothing went wrong.
        failedRun = true;
        leftBehind.push("memory: the Tool smoke section is still in it");
      }
    }
  }

  const uploaded = (await run("upload_file", {
    filename: `tool-smoke-${Date.now()}.md`,
    content: "Written by soko-bot:tool-smoke. Safe to delete.",
  })) as { id?: string; filename?: string } | null;
  if (uploaded) {
    leftBehind.push(`File: ${uploaded.filename ?? uploaded.id ?? "uploaded"}`);
  }

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
      })) as { resultingEntityId?: string | null } | null;
      // The id the hire returned, not the owner's newest Job: a scheduled turn
      // or another session can create one in between, and this would then
      // report and poll somebody else's work as the smoke run's own.
      const jobId = job?.resultingEntityId ?? null;
      if (jobId) {
        leftBehind.push(`Job: ${jobId} (real credits spent)`);
        await run("get_job_status", { jobId });
      } else {
        skip("get_job_status", "the hire returned no job id");
      }
      skip("provide_job_input", "only reachable once a Job asks for input");
    }
  }

  // ---- asking the owner, and writing to a colleague --------------------------
  // A pending decision is a real prompt in the owner's UI, so it is created
  // (that is the tool) and removed again by `cleanUp` with the turn that owns
  // it, on the interrupt path as well as the happy one.
  await run("request_user_decision", {
    toolName: "create_task",
    reason: "Tool smoke run: proving request_user_decision reaches the owner.",
    proposal: {
      name: "Tool smoke decision",
      description: "Created by soko-bot:tool-smoke. Safe to reject.",
    },
  });

  // The only tool here whose side effect lands on somebody other than the
  // owner: it opens a chat with a colleague and writes them a message. Run it
  // when a person is named, and say plainly that it is untested otherwise
  // rather than quietly counting it as covered.
  const dmPerson = flag("--dm");
  if (dmPerson) {
    await run("open_direct_chat", {
      person: dmPerson,
      message:
        "Tool smoke run from a Soko Bot harness. No reply needed, sorry for the noise.",
    });
    leftBehind.push(`Direct chat opened with ${dmPerson}`);
  } else {
    skip(
      "open_direct_chat",
      "would message a real colleague; pass --dm <name or email>",
    );
  }

  // Every capability accounted for, so a run cannot report "29 ok" while two
  // tools were never reached at all.
  const untouched = SOKO_BOT_CAPABILITIES.filter(
    (capability) => !results.has(capability),
  );
  for (const capability of untouched) {
    results.set(capability, { outcome: "MISSING", note: "never exercised" });
  }
  const width = Math.max(...[...results.keys()].map((name) => name.length));
  for (const capability of SOKO_BOT_CAPABILITIES) {
    const result = results.get(capability);
    if (!result) continue;
    console.log(
      `${result.outcome.padEnd(8)} ${capability.padEnd(width)}  ${result.note}`,
    );
  }
  const count = (outcome: string) =>
    [...results.values()].filter((r) => r.outcome === outcome).length;
  console.log(
    `\n${count("ok")} ok, ${count("FAILED")} failed, ${count("skipped")} skipped, ${untouched.length} never exercised, of ${SOKO_BOT_CAPABILITIES.length} capabilities`,
  );
  if (leftBehind.length > 0)
    console.log(`Left behind: ${leftBehind.join(" · ")}`);
  failedRun = failedRun || count("FAILED") > 0;
} finally {
  // Exits non-zero when anything could not be cleaned up: a synthetic turn
  // still marked RUNNING blocks the bot's next real turn, and a run that says
  // nothing about it leaves that for somebody to discover later.
  const clean = await cleanUp();
  await prisma.$disconnect();
  if (!clean || failedRun) process.exitCode = 1;
}
