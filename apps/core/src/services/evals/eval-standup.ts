import type { ScenarioCheck } from "@sokosumi/soko-bot";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { setEvalCoworkerScript } from "@/lib/evals/fake-coworker";
import { runTeamStandup } from "@/services/team-standup.service";
import { closeA2aWorld, ensureA2aWorld } from "./eval-a2a";
import type { CaseOutcome, CasePoll, CaseStart } from "./eval-case-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * The daily agent stand-up in an eval lane, run for real (the host model
 * included) on a world Core sets up: Robin's bot and Juno joined, Mira on a
 * running Task and one waiting for Robin, Robin's unassigned DACH study.
 * `quiet` has nothing new, so nothing may be posted; `no-match` has a need
 * nobody's work touches (the offsite venue), so no hand-off may open.
 */
export type StandupEvalSetup = "quiet" | "match" | "no-match";

const PRIVATE_TASK = "Salary bands for 2027 (private)";
const NEED = "DACH market study for the launch";
const UNRELATED_NEED = "Book the venue for the March team offsite";
const MIRA_ANSWER =
  "From my EU marketplace pricing research: in DACH, Langdock and Agentur.ai are the two that matter for small companies; my notes and sources are in the research Task.";
const ANSWER_TIMEOUT_MS = 5 * 60_000;

async function standupFor(lane: EvalLaneRecord) {
  return prisma.teamStandup.upsert({
    where: { organizationId: lane.organizationId },
    create: { organizationId: lane.organizationId, enabled: true },
    update: { enabled: true },
    select: { id: true },
  });
}

async function prepare(lane: EvalLaneRecord, setup: StandupEvalSetup) {
  const world = await ensureA2aWorld(lane);
  await prisma.task.updateMany({
    where: { workspaceId: lane.workspaceId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  await prisma.sokoBot.updateMany({
    where: { id: { in: [lane.sokoBotId, world.junoId] } },
    data: { joinsTeamStandup: true },
  });
  await prisma.teamStandupRun.deleteMany({
    where: { standup: { organizationId: lane.organizationId } },
  });
  if (setup === "quiet") {
    // A stand-up that just ran: the window starts now, whatever earlier
    // cases in this lane did today.
    const standup = await standupFor(lane);
    await prisma.teamStandupRun.create({
      data: {
        standupId: standup.id,
        scheduledFor: new Date(0),
        status: "QUIET",
      },
    });
    return world;
  }
  await setEvalCoworkerScript(world.coworkerId, [MIRA_ANSWER]);
  const task = (data: {
    name: string;
    status: "RUNNING" | "INPUT_REQUIRED" | "DRAFT";
    assigneeId?: string;
    visibility?: "PRIVATE";
    description?: string;
  }) =>
    prisma.task.create({
      data: {
        ...data,
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        ownerId: lane.userId,
        creatorUserId: lane.userId,
      },
    });
  await task({
    name: "EU marketplace pricing research",
    status: "RUNNING",
    assigneeId: world.coworkerId,
    description: "Pricing pages of five EU AI-agent marketplaces, DACH first.",
  });
  await task({
    name: "Competitor note on Langdock",
    status: "INPUT_REQUIRED",
    assigneeId: world.coworkerId,
  });
  await task({
    name: PRIVATE_TASK,
    status: "RUNNING",
    assigneeId: world.coworkerId,
    visibility: "PRIVATE",
  });
  await task(
    setup === "no-match"
      ? {
          name: UNRELATED_NEED,
          status: "DRAFT",
          description: "Find a venue in Berlin for 12 people, 3 to 5 March.",
        }
      : {
          name: NEED,
          status: "DRAFT",
          description:
            "Who sells AI agents to small companies in Germany, Austria and Switzerland, at what price.",
        },
  );
  return world;
}

export async function startStandupCase(
  setup: StandupEvalSetup,
  lane: EvalLaneRecord,
): Promise<CaseStart> {
  await prepare(lane, setup);
  const standup = await standupFor(lane);
  const scheduledFor = await databaseNow();
  const outcome = await runTeamStandup({ standupId: standup.id, scheduledFor });
  return {
    kind: "started",
    turnId: null,
    state: {
      standup: {
        status: outcome?.status ?? "NOT_RUN",
        runId: outcome?.runId ?? null,
        messageId: outcome?.messageId ?? null,
        mentionIds: outcome?.mentionIds ?? [],
        startedAt: scheduledFor.toISOString(),
      },
    },
  };
}

interface StandupState {
  status: string;
  runId: string | null;
  messageId: string | null;
  mentionIds: string[];
  startedAt: string;
}

function check(label: string, pass: boolean, actual: string): ScenarioCheck {
  return { label, pass, actual };
}

export async function pollStandupCase(
  setup: StandupEvalSetup,
  lane: EvalLaneRecord,
  state: unknown,
): Promise<CasePoll> {
  const run = (state as { standup?: StandupState } | null)?.standup;
  if (!run) throw new Error("The stand-up case has no run");
  const done = (outcome: Omit<CaseOutcome, "turnIds">): CasePoll => ({
    kind: "done",
    outcome: { ...outcome, turnIds: [] },
  });
  const posted = run.messageId
    ? await prisma.chatRoomMessage.findUnique({
        where: { id: run.messageId },
        select: { content: true },
      })
    : null;
  const row = run.runId
    ? await prisma.teamStandupRun.findUnique({
        where: { id: run.runId },
        select: { costUsdMicros: true, error: true },
      })
    : null;
  if (setup === "quiet") {
    const checks = [
      check("Nothing new: nothing posted", run.status === "QUIET", run.status),
    ];
    await closeA2aWorld(lane);
    return done({
      status: checks.every((c) => c.pass) ? "PASSED" : "FAILED",
      checks,
      output: { status: run.status },
    });
  }
  const answering = await prisma.chatRoomMention.count({
    where: {
      id: { in: run.mentionIds },
      status: { in: ["staged", "pending", "sent"] },
    },
  });
  if (
    answering > 0 &&
    Date.now() - new Date(run.startedAt).getTime() < ANSWER_TIMEOUT_MS
  )
    return { kind: "waiting" };
  const content = posted?.content ?? "";
  const thread = run.messageId
    ? await prisma.chatRoomMessage.findMany({
        where: { parentMessageId: run.messageId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          content: true,
          senderCoworkerId: true,
          senderSokoBotId: true,
        },
      })
    : [];
  const handoff = thread.find(
    (message) => message.senderSokoBotId === lane.sokoBotId,
  );
  const answer = thread.find((message) => message.senderCoworkerId);
  const costUsd = Number(row?.costUsdMicros ?? 0) / 1e6;
  if (setup === "no-match") {
    const checks = [
      check("Posted", run.status === "POSTED", row?.error ?? run.status),
      check(
        "No hand-off for a need nobody's work touches",
        !handoff,
        handoff ? handoff.content.slice(0, 160) : "none",
      ),
      check(
        "The unassigned venue Task is in Robin's bot's line",
        content.includes(UNRELATED_NEED),
        content.includes(UNRELATED_NEED) ? "listed" : "missing",
      ),
    ];
    await closeA2aWorld(lane);
    return done({
      status: checks.every((c) => c.pass) ? "PASSED" : "FAILED",
      checks,
      output: { answer: content, thread: thread.map((m) => m.content) },
    });
  }
  const checks = [
    check("Posted", run.status === "POSTED", row?.error ?? run.status),
    check(
      "Mira's line comes from her Task states",
      /mira[^\n]*today: "eu marketplace pricing research"/i.test(content),
      content.split("\n").find((line) => /mira/i.test(line)) ?? "no Mira line",
    ),
    check(
      "The Task waiting for Robin mentions him",
      content.includes(`@${lane.userId}`),
      content.includes(`@${lane.userId}`) ? "mentioned" : "not mentioned",
    ),
    check(
      "No private Task in the thread",
      !content.includes(PRIVATE_TASK) && !content.includes("Salary"),
      content.includes("Salary") ? "private Task shown" : "clean",
    ),
    check(
      "The DACH need opened a hand-off to Mira",
      !!handoff && /@mira-evals-/.test(handoff.content),
      handoff ? handoff.content.slice(0, 160) : "no hand-off",
    ),
    check(
      "The hand-off is a request: goal, what is needed back, by when",
      !!handoff &&
        /- Goal:/.test(handoff.content) &&
        /- What I need back:/.test(handoff.content) &&
        /- By:/.test(handoff.content),
      handoff ? "structured" : "no hand-off",
    ),
    check(
      "Mira answered in the thread",
      !!answer,
      answer ? answer.content.slice(0, 160) : "no answer",
    ),
    check(
      "Under the cost cap ($0.10)",
      costUsd <= 0.1,
      `$${costUsd.toFixed(4)}`,
    ),
  ];
  await closeA2aWorld(lane);
  return done({
    status: checks.every((c) => c.pass) ? "PASSED" : "FAILED",
    checks,
    output: { answer: content, thread: thread.map((m) => m.content) },
  });
}
