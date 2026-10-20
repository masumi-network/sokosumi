import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import type { FileActor } from "./actor";
import { buildAuthorizedResourceSql } from "./evidence-scope";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const WS = randomUUID();
const PROJECT = randomUUID();
const OTHER_PROJECT = randomUUID();
const MEMBER = `member-${randomUUID()}`;
const ORG = `org-${randomUUID()}`;

const OUTPUTS = {
  publicInProject: randomUUID(),
  privateOfMember: randomUUID(),
  publicInOtherProject: randomUUID(),
};

class Rollback extends Error {}

// Opt-in real Postgres proof of the Task-output arm. Foreign keys are off
// inside the rolled-back transaction, so the fixture holds only what it reads.
async function visibleOutputs(actor: FileActor): Promise<string[]> {
  if (!db) throw new Error("Missing integration database");
  let ids: string[] = [];
  await db
    .$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        const output = async (
          fileId: string,
          projectId: string,
          visibility: "PUBLIC" | "PRIVATE",
        ) => {
          const taskId = randomUUID();
          await tx.$executeRaw`INSERT INTO task (id, "updatedAt", "ownerId", "creatorUserId", name, status, "workspaceId", "projectId", visibility) VALUES (${taskId}, now(), ${MEMBER}, ${MEMBER}, ${taskId}, 'READY', ${WS}::uuid, ${projectId}::uuid, ${visibility}::"TaskVisibility")`;
          await tx.$executeRaw`INSERT INTO file_resource (id, "updatedAt", "workspaceId", "sourceKind", "sourceScope", "sourceId", "sourceTaskId", "displayName", "normalizedName", lifecycle) VALUES (${fileId}::uuid, now(), ${WS}::uuid, 'TASK_OUTPUT', 'ORGANIZATION', ${fileId}, ${taskId}, ${fileId}, ${fileId}, 'ACTIVE')`;
        };
        await output(OUTPUTS.publicInProject, PROJECT, "PUBLIC");
        await output(OUTPUTS.privateOfMember, PROJECT, "PRIVATE");
        await output(OUTPUTS.publicInOtherProject, OTHER_PROJECT, "PUBLIC");
        const rows = await tx.$queryRaw<{ id: string }[]>`
          SELECT fr.id::text AS id FROM file_resource fr
          WHERE ${buildAuthorizedResourceSql({ workspaceId: WS, actor })}`;
        ids = rows.map((row) => row.id).sort();
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
  return ids;
}

const personal: FileActor = {
  userId: MEMBER,
  organizationId: ORG,
  kind: "soko_bot",
};
const scope = { sokoBotId: randomUUID(), workspaceId: WS, projectId: PROJECT };

describe.skipIf(!enabled)("Task outputs a Soko Bot reads (Postgres)", () => {
  it("gives a personal bot the member's private outputs too", async () => {
    expect(await visibleOutputs(personal)).toEqual(
      Object.values(OUTPUTS).sort(),
    );
  });

  it("gives a project bot only public outputs in its Project", async () => {
    expect(await visibleOutputs({ ...personal, sokoBotScope: scope })).toEqual([
      OUTPUTS.publicInProject,
    ]);
  });

  it("gives a workspace bot public outputs in every Project", async () => {
    expect(
      await visibleOutputs({
        ...personal,
        sokoBotScope: { ...scope, projectId: null },
      }),
    ).toEqual([OUTPUTS.publicInProject, OUTPUTS.publicInOtherProject].sort());
  });
});
