import { randomUUID } from "node:crypto";
import { DAY_MS } from "@/config/constants";
import prisma from "@/lib/db/prisma";
import type { LabScenario } from "@/services/soko-bot-lab-scenario.service";
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
    forbiddenTools: ["update_schedule", "delete_schedule", "create_schedule"],
    answerMatches: "summer campaign|Q2 launch",
    noDelegations: true,
  },
};

export function isSchedulesCase(id: string): boolean {
  return id === SCHEDULES_SCENARIO.id;
}

/** Seeds after the lane reset, which clears the bot's schedules but not Task Schedules. */
export async function prepareSchedulesCase(
  lane: EvalLaneRecord,
): Promise<void> {
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
