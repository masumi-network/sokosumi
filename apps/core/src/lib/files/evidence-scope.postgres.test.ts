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

const PEOPLE = {
  maker: `maker-${randomUUID()}`,
  colleague: `colleague-${randomUUID()}`,
  admin: `admin-${randomUUID()}`,
  outsider: `outsider-${randomUUID()}`,
};
const DRIVE = {
  inRoom: randomUUID(),
  besideRoom: randomUUID(),
  sameNamePrefix: randomUUID(),
};

// An organization data room's files, as each member reads the catalog.
async function visibleDriveFiles(actor: FileActor): Promise<string[]> {
  if (!db) throw new Error("Missing integration database");
  let ids: string[] = [];
  await db
    .$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        for (const [userId, role] of [
          [PEOPLE.maker, "member"],
          [PEOPLE.colleague, "member"],
          [PEOPLE.admin, "admin"],
          [PEOPLE.outsider, "member"],
        ] as const)
          await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role) VALUES (${randomUUID()}, ${userId}, ${ORG}, ${role})`;
        const roomId = randomUUID();
        await tx.$executeRaw`INSERT INTO data_room (id, "updatedAt", "workspaceId", "sourceScope", "ownerId", "folderPath", "createdByUserId", token) VALUES (${roomId}::uuid, now(), ${WS}::uuid, 'ORGANIZATION', ${ORG}, 'Deals/Acme', ${PEOPLE.maker}, ${randomUUID()})`;
        await tx.$executeRaw`INSERT INTO data_room_colleague ("roomId", "userId", "addedByUserId") VALUES (${roomId}::uuid, ${PEOPLE.colleague}, ${PEOPLE.maker})`;
        const file = async (fileId: string, path: string) => {
          const sourceId = `drive/organizations/${ORG}/${path}`;
          await tx.$executeRaw`INSERT INTO file_resource (id, "updatedAt", "workspaceId", "sourceKind", "sourceScope", "sourceId", "ownerOrganizationId", "displayName", "normalizedName", lifecycle) VALUES (${fileId}::uuid, now(), ${WS}::uuid, 'DRIVE_UPLOAD', 'ORGANIZATION', ${sourceId}, ${ORG}, ${fileId}, ${fileId}, 'ACTIVE')`;
        };
        await file(DRIVE.inRoom, "Deals/Acme/Term sheet.pdf");
        await file(DRIVE.besideRoom, "Deals/Notes.txt");
        await file(DRIVE.sameNamePrefix, "Deals/Acme Corp/Logo.png");
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

describe.skipIf(!enabled)("Organization data rooms (Postgres)", () => {
  const as = (userId: string, kind: FileActor["kind"] = "interactive") =>
    visibleDriveFiles({ userId, organizationId: ORG, kind });
  const everything = Object.values(DRIVE).sort();
  const outside = [DRIVE.besideRoom, DRIVE.sameNamePrefix].sort();

  it("hides the room's files from a member outside it, and nothing else", async () => {
    expect(await as(PEOPLE.outsider)).toEqual(outside);
  });

  it("shows them to the maker, a colleague and an admin", async () => {
    expect(await as(PEOPLE.maker)).toEqual(everything);
    expect(await as(PEOPLE.colleague)).toEqual(everything);
    expect(await as(PEOPLE.admin)).toEqual(everything);
  });

  it("hides them from an agent acting even for the maker", async () => {
    expect(await as(PEOPLE.maker, "soko_bot")).toEqual(outside);
    expect(await as(PEOPLE.maker, "coworker")).toEqual(outside);
  });
});
