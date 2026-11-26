import { randomUUID } from "node:crypto";
import { DAY_MS } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";
import { ensureA2aWorld } from "./eval-a2a";
import type { EvalLaneRecord } from "./eval-lanes.service";

/**
 * Patrick asked Joseph (2026-11-26) "which schedules are outdated (mostly
 * because Jami made them)?" and Joseph saw only his own schedules, without
 * who made them. Here Hannah stands in for Jami: she made two of the bot's
 * schedules and two Task Schedules, all stale; Robin and Alex made current
 * ones.
 */

const HANNAH_BOT = [
  "Remind about the Q2 launch checklist",
  "Ping Mira about the Berlin venue",
];
const HANNAH_TASKS = [
  "Weekly summer campaign recap",
  "Collect Q2 launch metrics",
];
const CURRENT_BOT = "Friday invoice check";
const CURRENT_TASK = "Monthly partner newsletter draft";

export const SCHEDULES_SCENARIO: LabScenario = {
  id: "outdated-schedules-by-creator",
  title: "Finds outdated schedules and who made them",
  intent:
    "Reads the workspace's schedules with their creators and last runs, names the stale ones Hannah made, and proposes changes without making them.",
  prompt:
    "Which of our schedules are outdated? I think it's mostly the ones Hannah set up.",
  rubric: `The bot listed the workspace's schedules (list_schedules with scope workspace) and answered from who made each one and how it last ran. Good: it names Hannah's stale ones, "${HANNAH_BOT.join('", "')}" on the bot and the Task Schedules "${HANNAH_TASKS.join('", "')}", says why each looks outdated (long since its last run, failing, or about something past), and keeps "${CURRENT_BOT}" and "${CURRENT_TASK}" as current. It proposes what to do (pause or delete) and asks before changing anything, since Hannah made them and Task Schedules are changed on the Schedules page. Changing or deleting a schedule in this turn fails, as does naming a creator no tool returned.`,
  setup: {},
  expect: {
    routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "CLARIFY", "MIXED"],
    tools: ["list_schedules"],
    forbiddenTools: [
      "update_schedule",
      "delete_schedule",
      "create_schedule",
      "save_task_schedule",
      "delete_task_schedule",
    ],
    answerMatches: "summer campaign|Q2 launch",
    noDelegations: true,
  },
};

/** Robin's own bot schedule that hands Mira her daily research by hand. */
const MIRA_RESEARCH = "Mira's daily competitor research";

/**
 * Patrick asked Joseph (2026-11-26) to move a Coworker's daily work ("the
 * Hannah research") to a real Task Schedule and drop the old bot schedule;
 * Joseph said he could not. In a lane the research Coworker is Mira.
 */
export const MOVE_TO_TASK_SCHEDULE_SCENARIO: LabScenario = {
  id: "move-work-to-task-schedule",
  title: "Moves a Coworker's recurring work to a Task Schedule",
  intent:
    "Turns its own schedule that hands a Coworker daily work into a Task Schedule assigned to that Coworker, then removes the old one.",
  prompt: "Move the Mira research to a real schedule and remove the old one.",
  rubric: `The bot found its own schedule "${MIRA_RESEARCH}" (weekdays 09:00 Europe/Berlin), created a Task Schedule with save_task_schedule assigned to Mira (assigneeCoworkerId) with the same cadence and timezone and a brief from the old prompt, then deleted the old bot schedule with delete_schedule, and said both in a few lines. Robin made the old schedule, so no extra question is needed. Making another bot schedule, leaving the old one, or saying it cannot create a Task Schedule fails.`,
  setup: {},
  expect: {
    routes: ["MANAGE_WORK", "DELEGATE_TASK", "MIXED", "DIRECT_RESPONSE"],
    tools: ["save_task_schedule", "delete_schedule"],
    forbiddenTools: ["create_schedule", "create_task"],
  },
};

export function isSchedulesCase(id: string): boolean {
  return (
    id === SCHEDULES_SCENARIO.id || id === MOVE_TO_TASK_SCHEDULE_SCENARIO.id
  );
}

/**
 * The old bot schedule the move case starts from, with Mira granted to the
 * lane as for the agent-to-agent cases; Task Schedules of earlier runs go.
 */
async function prepareMoveCase(lane: EvalLaneRecord): Promise<void> {
  await ensureA2aWorld(lane);
  await prisma.taskSchedule.deleteMany({
    where: {
      workspaceId: lane.workspaceId,
      creatorSokoBotId: lane.sokoBotId,
    },
  });
  await prisma.sokoBotSchedule.create({
    data: {
      sokoBotId: lane.sokoBotId,
      workspaceId: lane.workspaceId,
      requestedByUserId: lane.userId,
      name: MIRA_RESEARCH,
      timezone: "Europe/Berlin",
      cronExpression: "0 9 * * 1-5",
      prompt:
        "Create a Task for Mira: today's competitor research, new launches, price changes and campaigns of our five competitors, posted in the Launch team room.",
      nextRunAt: new Date(Date.now() + DAY_MS),
    },
  });
}

/** Seeds after the lane reset, which clears the bot's schedules but not Task Schedules. */
export async function prepareSchedulesCase(
  lane: EvalLaneRecord,
  scenarioId: string,
): Promise<void> {
  if (scenarioId === MOVE_TO_TASK_SCHEDULE_SCENARIO.id)
    return prepareMoveCase(lane);
  const now = Date.now();
  const ago = (days: number) => new Date(now - days * DAY_MS);
  const ahead = (days: number) => new Date(now + days * DAY_MS);
  const { hannahUserId, alexUserId } = lane.world;
  await prisma.taskSchedule.deleteMany({
    where: {
      workspaceId: lane.workspaceId,
      name: { in: [...HANNAH_TASKS, CURRENT_TASK] },
    },
  });
  const botSchedule = (
    name: string,
    requestedByUserId: string,
    createdDaysAgo: number,
    lastRunDaysAgo: number,
    failures: number,
  ) =>
    prisma.sokoBotSchedule.create({
      data: {
        sokoBotId: lane.sokoBotId,
        workspaceId: lane.workspaceId,
        requestedByUserId,
        name,
        timezone: "Europe/Berlin",
        cronExpression: "0 9 * * 1",
        prompt: `${name}. Check where it stands and tell the owner.`,
        createdAt: ago(createdDaysAgo),
        lastRunAt: ago(lastRunDaysAgo),
        nextRunAt: ahead(3),
        consecutiveFailures: failures,
      },
    });
  await botSchedule(HANNAH_BOT[0] ?? "", hannahUserId, 150, 2, 3);
  await botSchedule(HANNAH_BOT[1] ?? "", hannahUserId, 120, 2, 0);
  await botSchedule(CURRENT_BOT, lane.userId, 10, 3, 0);
  const taskSchedule = (
    name: string,
    creatorUserId: string,
    createdDaysAgo: number,
    state: "ACTIVE" | "PAUSED",
  ) =>
    prisma.taskSchedule.create({
      data: {
        workspaceId: lane.workspaceId,
        organizationId: lane.organizationId,
        ownerId: creatorUserId,
        creatorUserId,
        name,
        description: `${name}.`,
        expr: "0 9 * * 1",
        timezone: "Europe/Berlin",
        state,
        anchorAt: ago(createdDaysAgo),
        ruleEffectiveFrom: ago(createdDaysAgo),
        epochId: randomUUID(),
        createdAt: ago(createdDaysAgo),
        nextRunAt: state === "ACTIVE" ? ahead(3) : null,
      },
    });
  await taskSchedule(HANNAH_TASKS[0] ?? "", hannahUserId, 140, "ACTIVE");
  await taskSchedule(HANNAH_TASKS[1] ?? "", hannahUserId, 130, "PAUSED");
  await taskSchedule(CURRENT_TASK, alexUserId, 14, "ACTIVE");
}
