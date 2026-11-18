import { randomUUID } from "node:crypto";
import { workspaceRepository } from "@sokosumi/database/repositories";
import { CURATED_FILE_VOCABULARY } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { loadTaskTagCatalog } from "./task-tag-catalog";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
describe.skipIf(!enabled)("Task vocabulary in PostgreSQL", () => {
  it("includes every active curated and custom TAG in the selected workspace", async () => {
    const rollback = new Error("Roll back the test fixtures");
    await expect(
      prisma.$transaction(async (tx) => {
        async function workspace() {
          const user = await tx.user.create({
            data: {
              name: "Catalog test",
              email: `${randomUUID()}@example.test`,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
          return tx.workspace.create({ data: { userId: user.id } });
        }
        const home = await workspace();
        const other = await workspace();
        await workspaceRepository.seedCuratedVocabulary(home.id, tx);
        const custom = await tx.workspaceLabel.create({
          data: {
            workspaceId: home.id,
            kind: "TAG",
            displayName: "Customer sprint",
            normalizedName: "customer sprint",
            createdByUserId: home.userId,
            color: "green",
            vocabularyVersion: 3,
          },
        });
        await tx.workspaceLabel.createMany({
          data: [
            {
              workspaceId: home.id,
              kind: "TAG",
              displayName: "Archived",
              normalizedName: "archived",
              archivedAt: new Date(),
            },
            {
              workspaceId: home.id,
              kind: "TAG",
              displayName: "Merged",
              normalizedName: "merged",
              mergedIntoId: custom.id,
            },
            {
              workspaceId: other.id,
              kind: "TAG",
              displayName: "Foreign",
              normalizedName: "foreign",
            },
          ],
        });
        const labels = await loadTaskTagCatalog(home.id, tx);
        expect(labels.map((label) => label.displayName).sort()).toEqual(
          [
            ...CURATED_FILE_VOCABULARY.filter(
              (label) => label.kind === "TAG",
            ).map((label) => label.displayName),
            custom.displayName,
          ].sort(),
        );
        expect(labels.find((label) => label.id === custom.id)).toMatchObject({
          vocabularyVersion: 3,
          color: "green",
          isUnmodifiedDefault: false,
        });
        const seed = labels.find((label) => label.displayName === "Design")!;
        expect(seed.isUnmodifiedDefault).toBe(true);
        await tx.workspaceLabel.update({
          where: { id: seed.id },
          data: { description: "My team's product design rubric" },
        });
        expect(
          (await loadTaskTagCatalog(home.id, tx)).find(
            (label) => label.id === seed.id,
          )?.isUnmodifiedDefault,
        ).toBe(false);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
