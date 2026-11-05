import { randomUUID } from "node:crypto";

import {
  FileFieldOverrideDecision,
  FileIndexJobPipeline,
  FileLabelKind,
  FileMetadataProvenance,
  FileMetadataState,
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  findDriveRecentsCatalogEntries,
  findDriveUploadPathnamesWithLabels,
} from "@/helpers/drive-recents-labels";
import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import {
  enqueueFileIndexJob,
  leaseNextFileIndexJob,
} from "@/lib/files/index-jobs";
import {
  type JevLabelEvaluator,
  METADATA_LABEL_MIN_PROBABILITY,
} from "@/lib/files/jev-client";
import { resetJevScheduler } from "@/lib/files/jev-scheduler";
import { writeVersionChunks } from "@/services/file-index.service";
import {
  processFileSuggestionJobs,
  runSuggestionJob,
} from "@/services/file-suggestions.service";

/**
 * Files with no readable text get labels from their metadata.
 *
 * A video, an archive or an image used to end its suggestion run at
 * "no-text" and stay unlabelled for good. Jev is always a stub here.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
let marketingId = "";
let financeId = "";
let videoCategoryId = "";

interface RecordedCall {
  document: string;
  labelIds: string[];
  minProbability: number | undefined;
}

function recordingEvaluator(): JevLabelEvaluator & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async evaluateLabels(input) {
      calls.push({
        document: String(input.request.body.document),
        labelIds: input.labels.map((label) => label.id),
        minProbability: input.minProbability,
      });
      return {
        ok: true,
        chosen: input.labels.map((label) => label.id),
        reason: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        costUsd: "0.0001",
        generationId: "gen-test",
      };
    },
  };
}

async function createFile(input: {
  name: string;
  mimeType: string;
  folder?: string;
  extractionState: "INDEXED" | "UNSUPPORTED" | "QUARANTINED";
  text?: string;
}): Promise<{ resourceId: string; pathname: string }> {
  const pathname = `drive/users/${ownerId}/${input.folder ? `${input.folder}/` : ""}${input.name}`;
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: pathname,
      ownerUserId: ownerId,
      displayName: input.name,
      normalizedName: input.name,
      mimeType: input.mimeType,
      sizeBytes: 5 * 1024 * 1024,
      lifecycle: FileResourceLifecycle.ACTIVE,
      versions: {
        create: {
          revision: 1,
          objectKey: pathname,
          mimeType: input.mimeType,
          extractionState: input.extractionState,
        },
      },
    },
    select: { id: true, versions: { select: { id: true } } },
  });
  if (input.text) {
    await writeVersionChunks({
      versionId: resource.versions[0].id,
      evidenceScopeId: scopeId,
      scopeVersion: 1,
      chunks: chunkExtractedText(input.text),
    });
  }
  await enqueueFileIndexJob({
    resourceId: resource.id,
    pipeline: FileIndexJobPipeline.SUGGEST,
    contentRevision: 1,
    runAfter: new Date(Date.now() - 1_000),
  });
  return { resourceId: resource.id, pathname };
}

async function runNext(evaluator: JevLabelEvaluator) {
  const leased = await leaseNextFileIndexJob({
    pipeline: FileIndexJobPipeline.SUGGEST,
  });
  if (!leased) throw new Error("expected a queued suggestion job");
  return runSuggestionJob(leased, { evaluator, configured: () => true });
}

describe.skipIf(!enabled)("labels from metadata, against PostgreSQL", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Metadata owner",
        email: `metadata-owner-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    ownerId = owner.id;
    workspaceId = (
      await prisma.workspace.create({
        data: { userId: ownerId },
        select: { id: true },
      })
    ).id;
    scopeId = (
      await ensureEvidenceScope({
        workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: ownerId,
      })
    ).id;

    const label = async (kind: FileLabelKind, displayName: string) =>
      (
        await prisma.workspaceLabel.create({
          data: {
            workspaceId,
            kind,
            displayName,
            normalizedName: displayName.toLowerCase(),
            description: `About ${displayName}`,
          },
          select: { id: true },
        })
      ).id;
    marketingId = await label(FileLabelKind.TAG, "Marketing");
    financeId = await label(FileLabelKind.TAG, "Finance");
    videoCategoryId = await label(FileLabelKind.CATEGORY, "Marketing copy");
  });

  afterEach(async () => {
    resetJevScheduler();
    await prisma.fileResource.deleteMany({ where: { workspaceId } });
    await prisma.fileAuthorizationAdmission.deleteMany({
      where: { workspaceId },
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    await prisma.fileEvidenceScope.deleteMany({ where: { workspaceId } });
    await prisma.workspaceLabel.deleteMany({ where: { workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("labels a text-less video from its name, type, size and folder", async () => {
    const { resourceId } = await createFile({
      name: "q4-launch-promo.mp4",
      mimeType: "video/mp4",
      folder: "Marketing/Videos",
      extractionState: "UNSUPPORTED",
    });
    const evaluator = recordingEvaluator();

    const outcome = await runNext(evaluator);

    expect(outcome).toMatchObject({
      skipped: null,
      metadataOnly: true,
      costUsd: 0.0001,
      suggested: 3,
    });
    expect(evaluator.calls).toHaveLength(1);
    const [call] = evaluator.calls;
    expect(call.minProbability).toBe(METADATA_LABEL_MIN_PROBABILITY);
    expect(call.document).toContain("File name: q4-launch-promo.mp4");
    expect(call.document).toContain("Media type: video/mp4");
    expect(call.document).toContain("Size: 5.0 MB");
    expect(call.document).toContain("Folder: Marketing/Videos");

    const rows = await prisma.fileLabel.findMany({
      where: { resourceId },
      select: { state: true, provenance: true, evidenceSnippet: true },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.state).toBe(FileMetadataState.SUGGESTED);
      expect(row.provenance).toBe(FileMetadataProvenance.MODEL);
      // No span to quote, and a generated reason must never stand in for one.
      expect(row.evidenceSnippet).toBeNull();
    }
  });

  it("keeps the text bar for a document with text", async () => {
    await createFile({
      name: "budget.txt",
      mimeType: "text/plain",
      extractionState: "INDEXED",
      text: "The quarterly budget and revenue forecast.",
    });
    const evaluator = recordingEvaluator();

    const outcome = await runNext(evaluator);

    expect(outcome.metadataOnly).toBe(false);
    expect(evaluator.calls[0].minProbability).toBeUndefined();
    expect(evaluator.calls[0].document).toContain("quarterly budget");
  });

  it("sends nothing about a quarantined file", async () => {
    const { resourceId } = await createFile({
      name: "suspect.zip",
      mimeType: "application/zip",
      extractionState: "QUARANTINED",
    });
    const evaluator = recordingEvaluator();

    const outcome = await runNext(evaluator);

    expect(outcome.skipped).toBe("no-text");
    expect(evaluator.calls).toHaveLength(0);
    await expect(
      prisma.fileLabel.count({ where: { resourceId } }),
    ).resolves.toBe(0);
  });

  it("never asks again about a tag a person removed, and keeps their removal", async () => {
    const { resourceId } = await createFile({
      name: "brand-assets.zip",
      mimeType: "application/zip",
      extractionState: "UNSUPPORTED",
    });
    await prisma.fileLabel.create({
      data: {
        resourceId,
        labelId: marketingId,
        state: FileMetadataState.REJECTED,
        provenance: FileMetadataProvenance.MODEL,
        evidenceScopeId: scopeId,
        contentRevision: 1,
        vocabularyVersion: 1,
        decidedByUserId: ownerId,
        decidedAt: new Date(),
      },
    });
    await prisma.fileFieldOverride.create({
      data: {
        resourceId,
        field: "tags",
        labelId: marketingId,
        decision: FileFieldOverrideDecision.REJECT,
        evidenceScopeId: scopeId,
        contentRevision: 1,
        vocabularyVersion: 1,
        decidedByUserId: ownerId,
      },
    });
    const evaluator = recordingEvaluator();

    await runNext(evaluator);

    expect(evaluator.calls[0].labelIds).not.toContain(marketingId);
    const marketing = await prisma.fileLabel.findFirstOrThrow({
      where: { resourceId, labelId: marketingId },
      select: { state: true },
    });
    expect(marketing.state).toBe(FileMetadataState.REJECTED);
  });

  it("counts metadata-only files and spend in the run summary", async () => {
    await createFile({
      name: "podcast.mp3",
      mimeType: "audio/mpeg",
      extractionState: "UNSUPPORTED",
    });
    await createFile({
      name: "logo.svg",
      mimeType: "image/svg+xml",
      extractionState: "UNSUPPORTED",
    });

    const result = await processFileSuggestionJobs({
      shouldContinue: () => true,
      dependencies: {
        evaluator: recordingEvaluator(),
        configured: () => true,
      },
    });

    expect(result.processed).toBe(2);
    expect(result.metadataOnly).toBe(2);
    expect(result.costUsd).toBeCloseTo(0.0002);
  });

  describe("what Recents reads back", () => {
    it("shows category and tags, never a removed label", async () => {
      const { resourceId, pathname } = await createFile({
        name: "promo.mp4",
        mimeType: "video/mp4",
        extractionState: "UNSUPPORTED",
      });
      const assign = (labelId: string, state: FileMetadataState) =>
        prisma.fileLabel.create({
          data: {
            resourceId,
            labelId,
            state,
            provenance: FileMetadataProvenance.MODEL,
            evidenceScopeId: scopeId,
            contentRevision: 1,
            vocabularyVersion: 1,
          },
        });
      await assign(marketingId, FileMetadataState.SUGGESTED);
      await assign(financeId, FileMetadataState.REJECTED);
      await assign(videoCategoryId, FileMetadataState.CONFIRMED);

      const entries = await findDriveRecentsCatalogEntries({
        workspaceId,
        scope: "user",
        pathnames: [pathname, `drive/users/${ownerId}/not-adopted.zip`],
      });

      expect(entries.size).toBe(1);
      expect(entries.get(pathname)).toEqual({
        resourceId,
        category: { labelId: videoCategoryId, displayName: "Marketing copy" },
        tags: [{ labelId: marketingId, displayName: "Marketing" }],
      });

      await expect(
        findDriveUploadPathnamesWithLabels({
          workspaceId,
          scope: "user",
          labelIds: [marketingId],
        }),
      ).resolves.toEqual(new Set([pathname]));
      // Rejected is not findable either.
      await expect(
        findDriveUploadPathnamesWithLabels({
          workspaceId,
          scope: "user",
          labelIds: [financeId],
        }),
      ).resolves.toEqual(new Set());
      // And the other store never sees this one's files.
      await expect(
        findDriveUploadPathnamesWithLabels({
          workspaceId,
          scope: "organization",
          labelIds: [marketingId],
        }),
      ).resolves.toEqual(new Set());
    });
  });
});
