import type { ScenarioCheck } from "@sokosumi/soko-bot";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { setEvalCoworkerScript } from "@/lib/evals/fake-coworker";
import { runTeamStandup } from "@/services/team-standup.service";
import { runWeekInReview } from "@/services/team-standup-week.service";
import { closeA2aWorld, ensureA2aWorld } from "./eval-a2a";
import type { CaseOutcome, CasePoll, CaseStart } from "./eval-case-runner";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * The daily stand-up in an eval lane, run for real (the host model
 * included) on a world Core sets up: Robin's bot and Juno in it (on by
 * default), Mira on a running Task of Robin's and one waiting for him,
 * Robin's unassigned DACH study. Only bots post; Robin's bot tells Mira's work.
 * `quiet` has nothing new, so nothing may be posted; `no-match` has a need
 * nobody's work touches (the offsite venue), so no hand-off may open.
 * `week` runs the week in review: Robin finished a public Task and a private
 * one this week, and only the public one may be named.
 */
export type StandupEvalSetup = "quiet" | "match" | "no-match" | "week";

const WEEK_TASK = "Q1 roadmap draft";

const PRIVATE_TASK = "Salary bands for 2027 (private)";
const NEED = "DACH market study for the launch";
const UNRELATED_NEED = "Book the venue for the March team offsite";
const MIRA_ANSWER =
  "From my EU marketplace pricing research: in DACH, Langdock and Agentur.ai are the two that matter for small companies; my notes and sources are in the research Task.";
const ANSWER_TIMEOUT_MS = 5 * 60_000;

/** The case runs the stand-up itself, so the lane's stays off and the cron never posts there. */
async function standupFor(lane: EvalLaneRecord) {
  return prisma.teamStandup.upsert({
    where: { organizationId: lane.organizationId },
    create: { organizationId: lane.organizationId, enabled: false },
    update: { enabled: false, nextRunAt: null, weekInReviewNextRunAt: null },
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
    data: { leftTeamStandupAt: null },
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
  if (setup === "week") {
    await prisma.user.update({
      where: { id: lane.userId },
      data: { hideWeekFromStandup: false },
    });
    for (const [name, visibility] of [
      [WEEK_TASK, "PUBLIC"],
      [PRIVATE_TASK, "PRIVATE"],
    ] as const)
      await prisma.task.create({
        data: {
          name,
          visibility,
          status: "COMPLETED",
          workspaceId: lane.workspaceId,
          organizationId: lane.organizationId,
          ownerId: lane.userId,
          creatorUserId: lane.userId,
          events: { create: { status: "COMPLETED", userId: lane.userId } },
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
  const outcome =
    setup === "week"
      ? await runWeekInReview({ standupId: standup.id, scheduledFor })
      : await runTeamStandup({ standupId: standup.id, scheduledFor });
  return {
    kind: "started",
    turnId: null,
    state: {
      standup: {
        status: outcome?.status ?? "NOT_RUN",
        runId: outcome?.runId ?? null,
        messageId: outcome?.messageId ?? null,
        mentionIds:
          outcome && "mentionIds" in outcome ? outcome.mentionIds : [],
        agentMessageIds:
          outcome && "agentMessageIds" in outcome
            ? outcome.agentMessageIds
            : {},
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
  agentMessageIds?: Record<string, string>;
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
  if (setup === "week") {
    const content = posted?.content ?? "";
    const robin = content
      .split("\n")
      .find((line) => line.includes(`"${WEEK_TASK}"`));
    const checks = [
      check("Posted", run.status === "POSTED", row?.error ?? run.status),
      check(
        "Robin's line names the public Task he finished",
        !!robin && /Tasks? finished/.test(robin),
        robin ?? "no line",
      ),
      check(
        "No private Task in the thread",
        !content.includes(PRIVATE_TASK) && !content.includes("Salary"),
        content.includes("Salary") ? "private Task shown" : "clean",
      ),
      check(
        "Says where to turn it off",
        content.includes('"Include my week in the stand-up"'),
        content.split("\n").at(-1) ?? "",
      ),
      check(
        "Under the cost cap ($0.10)",
        Number(row?.costUsdMicros ?? 0) / 1e6 <= 0.1,
        `$${(Number(row?.costUsdMicros ?? 0) / 1e6).toFixed(4)}`,
      ),
    ];
    await closeA2aWorld(lane);
    return done({
      status: checks.every((c) => c.pass) ? "PASSED" : "FAILED",
      checks,
      output: { answer: content },
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
  const opener = posted?.content ?? "";
  const messages = await prisma.chatRoomMessage.findMany({
    where: { id: { in: Object.values(run.agentMessageIds ?? {}) } },
    select: {
      id: true,
      content: true,
      senderCoworkerId: true,
      senderSokoBotId: true,
    },
  });
  const botMessage = messages.find(
    (message) => message.senderSokoBotId === lane.sokoBotId,
  );
  const coworkerMessage = messages.find((message) => message.senderCoworkerId);
  const botText = botMessage?.content ?? "";
  const content = [opener, ...messages.map((message) => message.content)].join(
    "\n\n",
  );
  const thread = botMessage
    ? await prisma.chatRoomMessage.findMany({
        where: { parentMessageId: botMessage.id, deletedAt: null },
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
  const own = [
    check("Posted", run.status === "POSTED", row?.error ?? run.status),
    check(
      "A short opener, no digest",
      /^\*\*Stand-up · [^\n]+\*\*$/.test(opener),
      opener.slice(0, 160),
    ),
    check(
      "Robin's bot posted its own message",
      !!botMessage,
      botMessage ? botMessage.content.slice(0, 240) : "no message",
    ),
    check(
      "No private Task in the channel",
      !content.includes(PRIVATE_TASK) && !content.includes("Salary"),
      content.includes("Salary") ? "private Task shown" : "clean",
    ),
  ];
  if (setup === "no-match") {
    const checks = [
      ...own,
      check(
        "No hand-off for a need nobody's work touches",
        !handoff,
        handoff ? handoff.content.slice(0, 160) : "none",
      ),
      check(
        "Robin's bot names the open venue Task",
        /venue|offsite/i.test(botMessage?.content ?? ""),
        botMessage?.content.slice(0, 240) ?? "no message",
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
    ...own,
    check(
      "No Coworker posts a message of its own",
      !coworkerMessage,
      coworkerMessage ? coworkerMessage.content.slice(0, 160) : "none",
    ),
    check(
      "Robin's bot tells Mira's pricing work for Robin",
      /Mira/.test(botText) && /pricing/i.test(botText),
      botText.slice(0, 240) || "no message",
    ),
    check(
      "Mira's Task waiting for Robin mentions him in the bot's message",
      botText.includes(`@${lane.userId}`),
      botText.includes(`@${lane.userId}`) ? "mentioned" : "not mentioned",
    ),
    check(
      "No raw quoted Task titles",
      !messages.some((message) => /"[^"]{8,}"/.test(message.content)),
      "checked",
    ),
    check(
      "The DACH need opened a hand-off to Mira under Robin's bot's message",
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
