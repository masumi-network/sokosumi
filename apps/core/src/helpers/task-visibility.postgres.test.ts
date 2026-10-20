import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildSokoBotScopeJobWhere,
  buildSokoBotScopeTaskWhere,
  type SokoBotScope,
} from "./task-visibility";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const WS = randomUUID();
const OTHER_WS = randomUUID();
const PROJECT = randomUUID();
const OTHER_PROJECT = randomUUID();
const BOT = randomUUID();
const OTHER_BOT = randomUUID();
const MEMBER = `member-${randomUUID()}`;

const TASKS = {
  publicInProject: randomUUID(),
  privateInProject: randomUUID(),
  publicInOtherProject: randomUUID(),
  publicWithoutProject: randomUUID(),
  privateWithoutProject: randomUUID(),
  // Same Project id, but the Task lives in another workspace.
  publicInProjectOtherWorkspace: randomUUID(),
};

const JOBS = {
  ownHire: randomUUID(),
  otherBotHire: randomUUID(),
  onPublicProjectTask: randomUUID(),
  onPrivateTask: randomUUID(),
  onOtherProjectTask: randomUUID(),
  memberWithoutTask: randomUUID(),
  ownHireOtherWorkspace: randomUUID(),
};

class Rollback extends Error {}

// Opt-in real Postgres proof of the scope wheres. Foreign keys are off inside
// the rolled-back transaction, so the fixture holds only the rows it reads.
async function withFixtures(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        const task = (
          id: string,
          workspaceId: string,
          projectId: string | null,
          visibility: "PUBLIC" | "PRIVATE",
        ) =>
          tx.$executeRaw`INSERT INTO task (id, "updatedAt", "ownerId", "creatorUserId", name, status, "workspaceId", "projectId", visibility) VALUES (${id}, now(), ${MEMBER}, ${MEMBER}, ${id}, 'READY', ${workspaceId}::uuid, ${projectId}::uuid, ${visibility}::"TaskVisibility")`;
        await task(TASKS.publicInProject, WS, PROJECT, "PUBLIC");
        await task(TASKS.privateInProject, WS, PROJECT, "PRIVATE");
        await task(TASKS.publicInOtherProject, WS, OTHER_PROJECT, "PUBLIC");
        await task(TASKS.publicWithoutProject, WS, null, "PUBLIC");
        await task(TASKS.privateWithoutProject, WS, null, "PRIVATE");
        await task(
          TASKS.publicInProjectOtherWorkspace,
          OTHER_WS,
          PROJECT,
          "PUBLIC",
        );

        const job = (id: string, workspaceId: string, taskId: string | null) =>
          tx.$executeRaw`INSERT INTO "Job" (id, "updatedAt", "ownerId", "agentId", "agentJobId", "jobType", "workspaceId", "taskId") VALUES (${id}, now(), ${MEMBER}, 'agent', ${id}, 'FREE', ${workspaceId}::uuid, ${taskId})`;
        await job(JOBS.ownHire, WS, null);
        await job(JOBS.otherBotHire, WS, null);
        await job(JOBS.onPublicProjectTask, WS, TASKS.publicInProject);
        await job(JOBS.onPrivateTask, WS, TASKS.privateInProject);
        await job(JOBS.onOtherProjectTask, WS, TASKS.publicInOtherProject);
        await job(JOBS.memberWithoutTask, WS, null);
        await job(JOBS.ownHireOtherWorkspace, OTHER_WS, null);

        const hire = async (sokoBotId: string, jobId: string) => {
          const turnId = randomUUID();
          await tx.$executeRaw`INSERT INTO soko_bot_turn (id, "updatedAt", "sokoBotId", "requestedByUserId", "workspaceId", source, "clientTurnId", "userMessage", "capabilityNames", "deadlineAt") VALUES (${turnId}::uuid, now(), ${sokoBotId}::uuid, ${MEMBER}, ${WS}::uuid, 'CHAT', ${turnId}, 'hire', ARRAY[]::text[], now())`;
          await tx.$executeRaw`INSERT INTO soko_bot_delegation (id, "updatedAt", "turnId", "toolCallId", kind, action, "jobId") VALUES (${randomUUID()}::uuid, now(), ${turnId}::uuid, 'call', 'JOB', 'hire', ${jobId})`;
        };
        await hire(BOT, JOBS.ownHire);
        await hire(OTHER_BOT, JOBS.otherBotHire);
        await hire(BOT, JOBS.ownHireOtherWorkspace);

        await run(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

const projectScope: SokoBotScope = {
  sokoBotId: BOT,
  workspaceId: WS,
  projectId: PROJECT,
};
const workspaceScope: SokoBotScope = { ...projectScope, projectId: null };

async function visibleTasks(tx: Prisma.TransactionClient, scope: SokoBotScope) {
  const rows = await tx.task.findMany({
    where: {
      AND: [
        { id: { in: Object.values(TASKS) } },
        buildSokoBotScopeTaskWhere(scope),
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

async function visibleJobs(tx: Prisma.TransactionClient, scope: SokoBotScope) {
  const rows = await tx.job.findMany({
    where: {
      AND: [
        { id: { in: Object.values(JOBS) } },
        buildSokoBotScopeJobWhere(scope),
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

describe.skipIf(!enabled)("shared Soko Bot scope against PostgreSQL", () => {
  it("shows a project bot only the PUBLIC Tasks of its Project in its workspace", async () => {
    await withFixtures(async (tx) => {
      expect(await visibleTasks(tx, projectScope)).toEqual(
        new Set([TASKS.publicInProject]),
      );
    });
  });

  it("shows a workspace bot every PUBLIC Task in its workspace only", async () => {
    await withFixtures(async (tx) => {
      expect(await visibleTasks(tx, workspaceScope)).toEqual(
        new Set([
          TASKS.publicInProject,
          TASKS.publicInOtherProject,
          TASKS.publicWithoutProject,
        ]),
      );
    });
  });

  it("shows a project bot its own hires and Jobs on its visible Tasks", async () => {
    await withFixtures(async (tx) => {
      expect(await visibleJobs(tx, projectScope)).toEqual(
        new Set([JOBS.ownHire, JOBS.onPublicProjectTask]),
      );
    });
  });

  it("shows a workspace bot its own hires and Jobs on any PUBLIC Task in its workspace", async () => {
    await withFixtures(async (tx) => {
      expect(await visibleJobs(tx, workspaceScope)).toEqual(
        new Set([
          JOBS.ownHire,
          JOBS.onPublicProjectTask,
          JOBS.onOtherProjectTask,
        ]),
      );
    });
  });
});
