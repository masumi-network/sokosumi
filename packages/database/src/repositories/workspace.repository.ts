import {
  CURATED_VOCABULARY_VERSION,
  curatedFileVocabularyRows,
} from "@sokosumi/utils";

import { Prisma, type Workspace } from "../generated/prisma/client.js";

import { vendorGrantRepository } from "./vendor-grant.repository.js";
import { PersonalWorkspaceMissingError } from "./workspace-errors.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function ensureServiceplanGrantForWorkspace(
  workspace: Workspace,
  resolvedByUserId: string | null,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await vendorGrantRepository.ensureServiceplanWorkspaceGrantOnCreate({
    workspaceId: workspace.id,
    resolvedByUserId,
    tx,
  });
}

/**
 * Give a new workspace the curated Files vocabulary.
 *
 * **Why this is a chokepoint and not three call sites.** A workspace with no
 * vocabulary is not a workspace with a small feature: the suggestion job
 * completes without calling the model at all, writes nothing, and reports
 * success. So automatic tagging silently did nothing, forever, in a workspace
 * whose creation path forgot to seed. There are three `workspace.create` sites
 * today and a fourth would be added by someone who has never read this file,
 * which is why `workspace-creation-chokepoint.test.ts` fails when one appears.
 *
 * **Idempotent by `skipDuplicates`, on `(workspaceId, kind, normalizedName)`.**
 * A workspace that already holds a hand-made label with a curated name keeps
 * its own row untouched: that row may already carry assignments and rejection
 * tombstones keyed on its id, and `createdByUserId` is the only thing telling
 * product data from human data — overwriting it would leave a row that is half
 * each. Skipping is also what makes a second run a no-op.
 *
 * **`createdByUserId` is left null.** That null *is* the provenance marker.
 * Nothing else distinguishes a label the product shipped from one a person
 * made, and `POST /v1/drive/labels` always sets it from the request actor.
 *
 * Runs inside the caller's transaction, so a workspace and its vocabulary
 * commit together or not at all.
 */
async function seedCuratedVocabulary(
  workspaceId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.workspaceLabel.createMany({
    data: curatedFileVocabularyRows().map((row) => ({
      workspaceId,
      kind: row.kind,
      displayName: row.displayName,
      normalizedName: row.normalizedName,
      description: row.description,
      vocabularyVersion: CURATED_VOCABULARY_VERSION,
      // Deliberately absent: see the note above.
      createdByUserId: null,
    })),
    skipDuplicates: true,
  });
}

async function findOrganizationWorkspace({
  organizationId,
  tx,
}: {
  organizationId: string;
  tx: Prisma.TransactionClient;
}): Promise<Workspace | null> {
  return await tx.workspace.findUnique({
    where: { organizationId },
  });
}

export const workspaceRepository = {
  /**
   * The vocabulary seed, for the one creation path that does not go through
   * this repository (`POST /v1/users/{id}/personal-workspace`). Exported
   * rather than duplicated: the chokepoint is the function, and a second copy
   * of the row list is how the two drift.
   */
  seedCuratedVocabulary,

  async findPersonalWorkspace({
    userId,
    tx,
  }: {
    userId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace | null> {
    return await tx.workspace.findUnique({
      where: { userId },
    });
  },

  async upsertOrganizationWorkspace({
    organizationId,
    tx,
  }: {
    organizationId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Workspace> {
    const existingWorkspace = await findOrganizationWorkspace({
      organizationId,
      tx,
    });
    if (existingWorkspace) {
      await ensureServiceplanGrantForWorkspace(existingWorkspace, null, tx);
      return existingWorkspace;
    }

    try {
      const workspace = await tx.workspace.create({
        data: { organizationId },
      });

      await ensureServiceplanGrantForWorkspace(workspace, null, tx);
      await seedCuratedVocabulary(workspace.id, tx);

      return workspace;
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        const racedWorkspace = await findOrganizationWorkspace({
          organizationId,
          tx,
        });
        if (racedWorkspace) {
          await ensureServiceplanGrantForWorkspace(racedWorkspace, null, tx);
          return racedWorkspace;
        }
      }

      throw error;
    }
  },

  /**
   * Resolve the workspace for a user/org context.
   * Organization: find or create. Personal: find or throw
   * {@link PersonalWorkspaceMissingError} — never create.
   */
  async resolveWorkspaceForContext(
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<Workspace> {
    if (organizationId) {
      return await this.upsertOrganizationWorkspace({ organizationId, tx });
    }

    const personalWorkspace = await this.findPersonalWorkspace({ userId, tx });
    if (!personalWorkspace) {
      throw new PersonalWorkspaceMissingError();
    }

    await ensureServiceplanGrantForWorkspace(personalWorkspace, userId, tx);
    return personalWorkspace;
  },
};
