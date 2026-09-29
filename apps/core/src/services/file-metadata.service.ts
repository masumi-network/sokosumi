import {
  FileFieldOverrideDecision,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  type Prisma,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { FILE_TAGS_PER_RESOURCE_MAX } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import {
  conflict,
  forbidden,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { buildAuthorizedResourceSql } from "@/lib/files/evidence-scope";
// The project membership check lives with the image studio because that is
// where it was first needed; it is a plain workspace-membership gate and is
// reused here rather than duplicated. Confirming a project association never
// changes access, so this is a read gate on the *target*, nothing more.
import { requireProjectAccess } from "@/lib/image-studio/access";

/**
 * Metadata edits, and the overrides that make them stick.
 *
 * A manual decision is not just a row: it writes a `FileFieldOverride` that
 * survives re-extraction, a new extractor and a new model. Removing an
 * automatic tag records a rejection for that label id, and a retry or a
 * reindex cannot bring it back.
 */

export interface MetadataEditRequest {
  expectedMetadataRevision: number;
  addTagLabelIds?: string[];
  removeTagLabelIds?: string[];
  categoryLabelId?: string | null;
  confirmProjectIds?: string[];
  removeProjectIds?: string[];
  allowSuggestionsFor?: ("category" | "tags")[];
  /**
   * Withdraw the veto on these labels, and do nothing else.
   *
   * Deletes the REJECT tombstone for each named label so the model may
   * propose it again. It writes no `FileLabel` row, changes no state and
   * sets no provenance: a person only ever vetoes a label or withdraws a
   * veto, and the model still has to decide.
   *
   * Per label, not per field, and that is the whole point. The only two
   * things in the product that could clear a REJECT were `addTagLabelIds`
   * (which also asserts the tag, as CONFIRMED/MANUAL) and clearing the
   * category (which deletes *every* category override on the resource
   * regardless of decision). Both live inside the manual assign surface
   * that is being removed, and neither is label-scoped. Withdrawing one
   * veto must not withdraw the others.
   *
   * Not `allowSuggestionsFor`: that is field-scoped and deletes PIN rows
   * only — a different override with a different meaning. Widening it
   * would make one gesture do two unrelated things.
   */
  allowSuggestionsForLabelIds?: string[];
}

export type MetadataEditStatus =
  | "applied"
  | "conflict"
  | "forbidden"
  | "not-found";

export interface MetadataEditOutcome {
  resourceId: string;
  status: MetadataEditStatus;
  metadataRevision: number | null;
}

interface AuthorizedResource {
  id: string;
  workspaceId: string;
  metadataRevision: number;
  contentRevision: number;
  evidenceScopeId: string;
}

/**
 * Read the resource through the same authorization predicate search uses,
 * and pick up the evidence scope its metadata belongs in.
 */
export async function loadEditableResource(input: {
  workspaceId: string;
  actor: FileActor;
  resourceId: string;
  client?: Prisma.TransactionClient;
}): Promise<AuthorizedResource | null> {
  const client = input.client ?? prisma;
  const authorized = buildAuthorizedResourceSql({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  const rows = await client.$queryRaw<
    {
      id: string;
      workspaceId: string;
      metadataRevision: number;
      contentRevision: number;
      evidenceScopeId: string | null;
    }[]
  >(PrismaRaw.sql`
    SELECT fr.id, fr."workspaceId", fr."metadataRevision", fr."contentRevision",
      (
        SELECT fes.id FROM file_evidence_scope fes
        WHERE fes."workspaceId" = fr."workspaceId"
          AND fes."sourceKind" = fr."sourceKind"
          AND fes."sourceScope" = fr."sourceScope"
          AND fes."sourceId" = COALESCE(fr."ownerUserId", fr."ownerOrganizationId")
        LIMIT 1
      ) AS "evidenceScopeId"
    FROM file_resource fr
    WHERE ${authorized} AND fr.id = ${input.resourceId}::uuid
    LIMIT 1
  `);

  const row = rows[0];
  if (!row || !row.evidenceScopeId) return null;

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    metadataRevision: row.metadataRevision,
    contentRevision: row.contentRevision,
    evidenceScopeId: row.evidenceScopeId,
  };
}

export async function updateFileMetadata(input: {
  workspaceId: string;
  actor: FileActor;
  resourceId: string;
  request: MetadataEditRequest;
}): Promise<MetadataEditOutcome> {
  const resource = await loadEditableResource({
    workspaceId: input.workspaceId,
    actor: input.actor,
    resourceId: input.resourceId,
  });
  if (!resource)
    return {
      resourceId: input.resourceId,
      status: "not-found",
      metadataRevision: null,
    };

  if (resource.metadataRevision !== input.request.expectedMetadataRevision) {
    return {
      resourceId: input.resourceId,
      status: "conflict",
      metadataRevision: resource.metadataRevision,
    };
  }

  // Confirming a project needs read access to the *target*; it grants
  // nothing on the file. An inaccessible target is reported as not found so
  // its existence is not disclosed.
  for (const projectId of input.request.confirmProjectIds ?? []) {
    await requireProjectAccess({
      projectId,
      workspaceId: input.workspaceId,
      userId: input.actor.userId,
    });
  }

  const vocabulary = await loadVocabulary({
    workspaceId: input.workspaceId,
    labelIds: [
      ...(input.request.addTagLabelIds ?? []),
      ...(input.request.removeTagLabelIds ?? []),
      ...(input.request.categoryLabelId ? [input.request.categoryLabelId] : []),
      // Needed to derive each label's `field` from its kind, and to reject
      // an id that is not in this workspace's vocabulary at all.
      ...(input.request.allowSuggestionsForLabelIds ?? []),
    ],
  });

  const nextRevision = resource.metadataRevision + 1;

  try {
    await prisma.$transaction(async (tx) => {
      // Guard the revision inside the transaction so two concurrent editors
      // cannot both believe they won.
      const claimed = await tx.fileResource.updateMany({
        where: {
          id: resource.id,
          metadataRevision: input.request.expectedMetadataRevision,
        },
        data: { metadataRevision: nextRevision },
      });
      if (claimed.count !== 1) throw conflict("Updated elsewhere");

      await applyTagEdits({
        tx,
        resource,
        request: input.request,
        vocabulary,
        actor: input.actor,
      });
      await applyCategoryEdit({
        tx,
        resource,
        request: input.request,
        vocabulary,
        actor: input.actor,
      });
      await applyProjectEdits({
        tx,
        resource,
        request: input.request,
        actor: input.actor,
      });
      await applyAllowSuggestions({ tx, resource, request: input.request });
      await applyLabelVetoWithdrawals({
        tx,
        resource,
        request: input.request,
        vocabulary,
      });
    });
  } catch (error) {
    if (error instanceof HTTPException && error.status === 409) {
      const current = await prisma.fileResource.findUnique({
        where: { id: resource.id },
        select: { metadataRevision: true },
      });
      return {
        resourceId: input.resourceId,
        status: "conflict",
        metadataRevision: current?.metadataRevision ?? null,
      };
    }
    throw error;
  }

  return {
    resourceId: input.resourceId,
    status: "applied",
    metadataRevision: nextRevision,
  };
}

type VocabularyEntry = {
  id: string;
  kind: FileLabelKind;
  archivedAt: Date | null;
  vocabularyVersion: number;
  mergedIntoId: string | null;
};

async function loadVocabulary(input: {
  workspaceId: string;
  labelIds: string[];
}): Promise<Map<string, VocabularyEntry>> {
  if (input.labelIds.length === 0) return new Map();
  const labels = await prisma.workspaceLabel.findMany({
    where: { workspaceId: input.workspaceId, id: { in: input.labelIds } },
    select: {
      id: true,
      kind: true,
      archivedAt: true,
      vocabularyVersion: true,
      mergedIntoId: true,
    },
  });
  return new Map(labels.map((label) => [label.id, label]));
}

/** A merged label redirects; an unknown or archived one fails validation. */
function resolveLabel(
  vocabulary: Map<string, VocabularyEntry>,
  labelId: string,
  kind: FileLabelKind,
  allowArchived: boolean,
): VocabularyEntry {
  const entry = vocabulary.get(labelId);
  if (!entry) throw unprocessableEntity("Unknown label");
  if (entry.kind !== kind) throw unprocessableEntity("Label is the wrong kind");
  if (!allowArchived && entry.archivedAt) {
    throw unprocessableEntity(
      "This label is archived and takes no new assignments",
    );
  }
  return entry;
}

async function applyTagEdits(input: {
  tx: Prisma.TransactionClient;
  resource: AuthorizedResource;
  request: MetadataEditRequest;
  vocabulary: Map<string, VocabularyEntry>;
  actor: FileActor;
}): Promise<void> {
  const { tx, resource, request, vocabulary, actor } = input;

  for (const labelId of request.addTagLabelIds ?? []) {
    const entry = resolveLabel(vocabulary, labelId, FileLabelKind.TAG, false);
    const target = entry.mergedIntoId ?? entry.id;

    await tx.fileLabel.upsert({
      where: {
        resourceId_labelId_evidenceScopeId: {
          resourceId: resource.id,
          labelId: target,
          evidenceScopeId: resource.evidenceScopeId,
        },
      },
      create: {
        resourceId: resource.id,
        labelId: target,
        state: FileMetadataState.CONFIRMED,
        provenance: FileMetadataProvenance.MANUAL,
        evidenceScopeId: resource.evidenceScopeId,
        contentRevision: resource.contentRevision,
        vocabularyVersion: entry.vocabularyVersion,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
      update: {
        state: FileMetadataState.CONFIRMED,
        provenance: FileMetadataProvenance.MANUAL,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });

    // Adding a tag by hand clears any earlier rejection of it.
    await tx.fileFieldOverride.deleteMany({
      where: {
        resourceId: resource.id,
        field: "tags",
        labelId: target,
        evidenceScopeId: resource.evidenceScopeId,
      },
    });
  }

  for (const labelId of request.removeTagLabelIds ?? []) {
    const entry = resolveLabel(vocabulary, labelId, FileLabelKind.TAG, true);
    const target = entry.mergedIntoId ?? entry.id;

    await tx.fileLabel.updateMany({
      where: {
        resourceId: resource.id,
        labelId: target,
        evidenceScopeId: resource.evidenceScopeId,
      },
      data: {
        state: FileMetadataState.REJECTED,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });

    // The durable part: this label may not come back on its own.
    await tx.fileFieldOverride.upsert({
      where: {
        resourceId_field_labelId_evidenceScopeId: {
          resourceId: resource.id,
          field: "tags",
          labelId: target,
          evidenceScopeId: resource.evidenceScopeId,
        },
      },
      create: {
        resourceId: resource.id,
        field: "tags",
        labelId: target,
        decision: FileFieldOverrideDecision.REJECT,
        evidenceScopeId: resource.evidenceScopeId,
        contentRevision: resource.contentRevision,
        vocabularyVersion: entry.vocabularyVersion,
        decidedByUserId: actor.userId,
      },
      update: {
        decision: FileFieldOverrideDecision.REJECT,
        contentRevision: resource.contentRevision,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });
  }

  const confirmedTags = await tx.fileLabel.count({
    where: {
      resourceId: resource.id,
      state: FileMetadataState.CONFIRMED,
      label: { kind: FileLabelKind.TAG },
    },
  });
  if (confirmedTags > FILE_TAGS_PER_RESOURCE_MAX) {
    throw unprocessableEntity(
      `A file can carry at most ${FILE_TAGS_PER_RESOURCE_MAX} tags`,
    );
  }
}

async function applyCategoryEdit(input: {
  tx: Prisma.TransactionClient;
  resource: AuthorizedResource;
  request: MetadataEditRequest;
  vocabulary: Map<string, VocabularyEntry>;
  actor: FileActor;
}): Promise<void> {
  const { tx, resource, request, vocabulary, actor } = input;
  if (request.categoryLabelId === undefined) return;

  // Clearing the category removes the pin as well, so suggestions may apply
  // again — that is the explicit "allow suggestions" gesture.
  if (request.categoryLabelId === null) {
    await tx.fileLabel.deleteMany({
      where: {
        resourceId: resource.id,
        evidenceScopeId: resource.evidenceScopeId,
        label: { kind: FileLabelKind.CATEGORY },
      },
    });
    await tx.fileFieldOverride.deleteMany({
      where: {
        resourceId: resource.id,
        field: "category",
        evidenceScopeId: resource.evidenceScopeId,
      },
    });
    return;
  }

  const entry = resolveLabel(
    vocabulary,
    request.categoryLabelId,
    FileLabelKind.CATEGORY,
    false,
  );
  const target = entry.mergedIntoId ?? entry.id;

  // One visible primary category per evidence audience.
  await tx.fileLabel.deleteMany({
    where: {
      resourceId: resource.id,
      evidenceScopeId: resource.evidenceScopeId,
      label: { kind: FileLabelKind.CATEGORY },
      labelId: { not: target },
    },
  });

  await tx.fileLabel.upsert({
    where: {
      resourceId_labelId_evidenceScopeId: {
        resourceId: resource.id,
        labelId: target,
        evidenceScopeId: resource.evidenceScopeId,
      },
    },
    create: {
      resourceId: resource.id,
      labelId: target,
      state: FileMetadataState.CONFIRMED,
      provenance: FileMetadataProvenance.MANUAL,
      evidenceScopeId: resource.evidenceScopeId,
      contentRevision: resource.contentRevision,
      vocabularyVersion: entry.vocabularyVersion,
      decidedByUserId: actor.userId,
      decidedAt: new Date(),
    },
    update: {
      state: FileMetadataState.CONFIRMED,
      provenance: FileMetadataProvenance.MANUAL,
      decidedByUserId: actor.userId,
      decidedAt: new Date(),
    },
  });

  await tx.fileFieldOverride.upsert({
    where: {
      resourceId_field_labelId_evidenceScopeId: {
        resourceId: resource.id,
        field: "category",
        labelId: target,
        evidenceScopeId: resource.evidenceScopeId,
      },
    },
    create: {
      resourceId: resource.id,
      field: "category",
      labelId: target,
      decision: FileFieldOverrideDecision.PIN,
      evidenceScopeId: resource.evidenceScopeId,
      contentRevision: resource.contentRevision,
      vocabularyVersion: entry.vocabularyVersion,
      decidedByUserId: actor.userId,
    },
    update: {
      decision: FileFieldOverrideDecision.PIN,
      contentRevision: resource.contentRevision,
      decidedByUserId: actor.userId,
      decidedAt: new Date(),
    },
  });
}

async function applyProjectEdits(input: {
  tx: Prisma.TransactionClient;
  resource: AuthorizedResource;
  request: MetadataEditRequest;
  actor: FileActor;
}): Promise<void> {
  const { tx, resource, request, actor } = input;

  for (const projectId of request.confirmProjectIds ?? []) {
    await tx.fileProjectLink.upsert({
      where: {
        resourceId_projectId_evidenceScopeId: {
          resourceId: resource.id,
          projectId,
          evidenceScopeId: resource.evidenceScopeId,
        },
      },
      create: {
        resourceId: resource.id,
        projectId,
        state: FileMetadataState.CONFIRMED,
        provenance: FileMetadataProvenance.MANUAL,
        evidenceScopeId: resource.evidenceScopeId,
        contentRevision: resource.contentRevision,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
      update: {
        state: FileMetadataState.CONFIRMED,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });
  }

  for (const projectId of request.removeProjectIds ?? []) {
    await tx.fileProjectLink.updateMany({
      where: {
        resourceId: resource.id,
        projectId,
        evidenceScopeId: resource.evidenceScopeId,
      },
      data: {
        state: FileMetadataState.REJECTED,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      },
    });
  }
}

async function applyAllowSuggestions(input: {
  tx: Prisma.TransactionClient;
  resource: AuthorizedResource;
  request: MetadataEditRequest;
}): Promise<void> {
  const fields = input.request.allowSuggestionsFor ?? [];
  if (fields.length === 0) return;

  await input.tx.fileFieldOverride.deleteMany({
    where: {
      resourceId: input.resource.id,
      evidenceScopeId: input.resource.evidenceScopeId,
      field: { in: fields },
      decision: FileFieldOverrideDecision.PIN,
    },
  });
}

/**
 * Withdraw the veto on named labels: delete their REJECT tombstone, nothing else.
 *
 * Covers both kinds. A tag's tombstone is written by `removeTagLabelIds`
 * (`field: "tags"`) and a category's by dismissing a suggestion
 * (`field: "category"`), so a tags-only clear would leave a wrong category
 * permanent while a wrong tag was recoverable.
 *
 * `field` is derived from the label's own kind rather than taken from the
 * caller, so a caller cannot ask to forgive a tag under the category field
 * and silently match nothing.
 *
 * Scoped to `decision: REJECT`. A PIN on the same label is a different
 * statement — "this field is set by hand" — and is not this gesture's to
 * remove. That is the mistake the blunt category clear makes, and it is not
 * copied here.
 */
async function applyLabelVetoWithdrawals(input: {
  tx: Prisma.TransactionClient;
  resource: AuthorizedResource;
  request: MetadataEditRequest;
  vocabulary: Map<string, VocabularyEntry>;
}): Promise<void> {
  const labelIds = input.request.allowSuggestionsForLabelIds ?? [];
  if (labelIds.length === 0) return;

  for (const labelId of labelIds) {
    const entry = input.vocabulary.get(labelId);
    if (!entry) throw unprocessableEntity("Unknown label");
    // Archived is allowed: a label can be vetoed on a file and archived
    // afterwards, and the veto is still the thing being withdrawn. Whether
    // the model may then use it is the archive's decision, made elsewhere.
    const target = entry.mergedIntoId ?? entry.id;
    const field =
      entry.kind === FileLabelKind.CATEGORY ? "category" : ("tags" as const);

    await input.tx.fileFieldOverride.deleteMany({
      where: {
        resourceId: input.resource.id,
        evidenceScopeId: input.resource.evidenceScopeId,
        field,
        labelId: target,
        decision: FileFieldOverrideDecision.REJECT,
      },
    });

    /**
     * And the rejected assignment itself, or the withdrawal achieves nothing.
     *
     * The tombstone is what bars the label from the shortlist, so deleting it
     * lets the model consider the label again — and then `runSuggestionJob`
     * upserts with `update: {}`, because "an existing confirmed or rejected row
     * is a decision, it stands". The model's new suggestion would land on the
     * still-REJECTED row and be swallowed: allowed to ask the question,
     * forbidden to record the answer.
     *
     * Withdrawing a veto means there is no longer a decision on this label, so
     * the row that records the decision goes too. Scoped to REJECTED: a
     * CONFIRMED assignment is a different statement and is not this gesture's
     * to remove.
     *
     * Found by clicking the control on a preview, not by the tests — those
     * deleted these rows themselves between runs, which is the test doing the
     * product's job and passing for a reason the product does not provide.
     */
    await input.tx.fileLabel.deleteMany({
      where: {
        resourceId: input.resource.id,
        evidenceScopeId: input.resource.evidenceScopeId,
        labelId: target,
        state: FileMetadataState.REJECTED,
      },
    });
  }
}

/**
 * Accept or dismiss one suggestion. A dismissal holds for the same source
 * revision and vocabulary policy; new content may offer a new suggestion,
 * but a retry of the same one cannot.
 */
export async function decideFileSuggestion(input: {
  workspaceId: string;
  actor: FileActor;
  resourceId: string;
  suggestionId: string;
  decision: "accept" | "reject" | "restore";
  expectedMetadataRevision: number;
}): Promise<MetadataEditOutcome> {
  const resource = await loadEditableResource({
    workspaceId: input.workspaceId,
    actor: input.actor,
    resourceId: input.resourceId,
  });
  if (!resource) throw notFound("File not found");

  const suggestion = await prisma.fileLabel.findFirst({
    where: {
      id: input.suggestionId,
      resourceId: resource.id,
      evidenceScopeId: resource.evidenceScopeId,
    },
    select: {
      id: true,
      labelId: true,
      state: true,
      vocabularyVersion: true,
      label: { select: { kind: true, archivedAt: true } },
    },
  });
  if (!suggestion) throw notFound("Suggestion not found");
  // `restore` is the only decision that wants an already-decided row, and it
  // wants exactly the one this function wrote.
  if (
    input.decision === "restore"
      ? suggestion.state !== FileMetadataState.REJECTED
      : suggestion.state !== FileMetadataState.SUGGESTED
  ) {
    throw conflict("This suggestion was already decided");
  }
  if (input.decision === "accept" && suggestion.label.archivedAt) {
    throw unprocessableEntity(
      "This label is archived and takes no new assignments",
    );
  }

  if (input.decision === "accept") {
    return updateFileMetadata({
      workspaceId: input.workspaceId,
      actor: input.actor,
      resourceId: input.resourceId,
      request: {
        expectedMetadataRevision: input.expectedMetadataRevision,
        ...(suggestion.label.kind === FileLabelKind.CATEGORY
          ? { categoryLabelId: suggestion.labelId }
          : { addTagLabelIds: [suggestion.labelId] }),
      },
    });
  }

  const field =
    suggestion.label.kind === FileLabelKind.CATEGORY ? "category" : "tags";

  /**
   * Undo, which is not the same gesture as "let the model reconsider".
   *
   * `allowSuggestionsForLabelIds` already withdraws a veto, and it deletes the
   * rejected assignment along with the tombstone — correctly, because it is
   * saying there is no longer a decision on this label. But that leaves the
   * label off the document until something evaluates it again, and nothing
   * re-leases a SUCCEEDED suggestion job. As an Undo it would make the chip
   * disappear twice.
   *
   * This puts the same row back to SUGGESTED, so the chip the reader just
   * dismissed by accident reappears where it was. Both halves, or the label
   * comes back and the model is still barred from ever proposing it again.
   */
  if (input.decision === "restore") {
    if (resource.metadataRevision !== input.expectedMetadataRevision) {
      return {
        resourceId: input.resourceId,
        status: "conflict",
        metadataRevision: resource.metadataRevision,
      };
    }

    const restoredRevision = resource.metadataRevision + 1;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.fileResource.updateMany({
        where: {
          id: resource.id,
          metadataRevision: input.expectedMetadataRevision,
        },
        data: { metadataRevision: restoredRevision },
      });
      if (claimed.count !== 1) throw conflict("Updated elsewhere");

      await tx.fileLabel.update({
        where: { id: suggestion.id },
        data: {
          state: FileMetadataState.SUGGESTED,
          decidedByUserId: null,
          decidedAt: null,
        },
      });

      // Both halves of the dismissal, undone. Leaving the tombstone would
      // restore the label and still bar the model from proposing it, which
      // is the harder half of the mistake to see.
      await tx.fileFieldOverride.deleteMany({
        where: {
          resourceId: resource.id,
          field,
          labelId: suggestion.labelId,
          evidenceScopeId: resource.evidenceScopeId,
        },
      });
    });

    return {
      resourceId: input.resourceId,
      status: "applied",
      metadataRevision: restoredRevision,
    };
  }

  // Dismissal touches only the suggestion. A confirmed category the reader
  // already set must not be cleared because a different suggestion for the
  // same field was waved away.
  if (resource.metadataRevision !== input.expectedMetadataRevision) {
    return {
      resourceId: input.resourceId,
      status: "conflict",
      metadataRevision: resource.metadataRevision,
    };
  }

  const nextRevision = resource.metadataRevision + 1;

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.fileResource.updateMany({
      where: {
        id: resource.id,
        metadataRevision: input.expectedMetadataRevision,
      },
      data: { metadataRevision: nextRevision },
    });
    if (claimed.count !== 1) throw conflict("Updated elsewhere");

    await tx.fileLabel.update({
      where: { id: suggestion.id },
      data: {
        state: FileMetadataState.REJECTED,
        decidedByUserId: input.actor.userId,
        decidedAt: new Date(),
      },
    });

    await tx.fileFieldOverride.upsert({
      where: {
        resourceId_field_labelId_evidenceScopeId: {
          resourceId: resource.id,
          field,
          labelId: suggestion.labelId,
          evidenceScopeId: resource.evidenceScopeId,
        },
      },
      create: {
        resourceId: resource.id,
        field,
        labelId: suggestion.labelId,
        decision: FileFieldOverrideDecision.REJECT,
        evidenceScopeId: resource.evidenceScopeId,
        contentRevision: resource.contentRevision,
        vocabularyVersion: suggestion.vocabularyVersion,
        decidedByUserId: input.actor.userId,
      },
      update: {
        decision: FileFieldOverrideDecision.REJECT,
        contentRevision: resource.contentRevision,
        decidedByUserId: input.actor.userId,
        decidedAt: new Date(),
      },
    });
  });

  return {
    resourceId: input.resourceId,
    status: "applied",
    metadataRevision: nextRevision,
  };
}

/** Edit rights for a Drive-backed document follow the Drive gate. */
export function assertFileEditAllowed(actor: FileActor): void {
  if (actor.kind === "worker") {
    throw forbidden("Workers cannot edit file metadata");
  }
}
