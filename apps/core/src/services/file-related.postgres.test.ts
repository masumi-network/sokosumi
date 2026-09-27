import { randomUUID } from "node:crypto";

import {
  FileResourceLifecycle,
  FileSourceKind,
  FileSourceScope,
} from "@sokosumi/database";
import { beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import { chunkExtractedText } from "@/lib/files/extraction";
import { writeVersionChunks } from "@/services/file-index.service";
import { findRelatedFiles } from "@/services/file-related.service";

/**
 * Related documents against a real PostgreSQL.
 *
 * A unit test cannot catch what was wrong here, which is why this file
 * exists. The candidate query was
 * `plainto_tsquery('simple', <the seed's first 2,000 characters>)`, and
 * `plainto_tsquery` joins every term with **AND** — so a neighbour had to
 * contain every word of the seed. For any document longer than a phrase
 * that is unsatisfiable, and the feature returned nothing while rendering
 * as a calm "No related files yet".
 *
 * The shape of the bug matters for the shape of the test. A seed of two
 * words worked; the failure only appears as the seed gets longer. So the
 * seeds below are deliberately wordy, and the assertion is that a neighbour
 * is still found. Restoring AND turns these red.
 *
 * Jev is not involved: `configured` is false in this environment, so the
 * ranking stage falls back and these assertions are about our SQL.
 */

const databaseUrl = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  databaseUrl?.startsWith("postgres");

const suffix = randomUUID().slice(0, 8);
let ownerId = "";
let workspaceId = "";
let scopeId = "";
const ids: Record<string, string> = {};

function actor(): FileActor {
  return { userId: ownerId, organizationId: null, kind: "interactive" };
}

async function seedResource(displayName: string, text: string) {
  const resource = await prisma.fileResource.create({
    data: {
      workspaceId,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: `drive/users/${ownerId}/${displayName}`,
      ownerUserId: ownerId,
      displayName,
      normalizedName: displayName.toLowerCase(),
      mimeType: "text/plain",
      sizeBytes: text.length,
      lifecycle: FileResourceLifecycle.ACTIVE,
      versions: {
        create: {
          revision: 1,
          objectKey: `drive/users/${ownerId}/${displayName}`,
          mimeType: "text/plain",
          sizeBytes: text.length,
        },
      },
    },
    select: { id: true, versions: { select: { id: true } } },
  });

  await writeVersionChunks({
    versionId: resource.versions[0].id,
    evidenceScopeId: scopeId,
    scopeVersion: 1,
    chunks: chunkExtractedText(text),
  });

  ids[displayName] = resource.id;
  return resource.id;
}

/**
 * Two documents about the same subject, in the same wordy register a real
 * document uses, sharing distinctive vocabulary but **not** every word.
 *
 * The overlap is the point: "reconciliation", "ledger", "variance",
 * "settlement". The divergence is equally the point — each carries
 * sentences the other does not, so an AND over the whole seed cannot match.
 */
const LEDGER_A = [
  "Quarterly reconciliation memorandum for the finance committee.",
  "Revenue for the period was recorded against the ledger and reconciled",
  "line by line. The variance was attributed to timing differences in",
  "settlement rather than to any change in accounting policy.",
  "Outstanding items were carried forward into the following period.",
].join(" ");

const LEDGER_B = [
  "Annual reconciliation appendix prepared for the audit working papers.",
  "Each ledger account was agreed to the settlement file and the variance",
  "schedule was recalculated. Timing differences dominate the residual.",
  "The committee accepted the reconciliation without amendment.",
].join(" ");

/** Same language register, entirely different subject. */
const KITCHEN = [
  "Kitchen renovation quotes from three separate contractors.",
  "The worktop, the splashback and the extractor hood are itemised",
  "separately, with delivery scheduled for the following month.",
].join(" ");

describe.skipIf(!enabled)("related documents against PostgreSQL", () => {
  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: {
        name: "Related owner",
        email: `related-owner-${suffix}@example.test`,
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

    await seedResource("ledger-a.txt", LEDGER_A);
    await seedResource("ledger-b.txt", LEDGER_B);
    await seedResource("kitchen.txt", KITCHEN);
  });

  it("finds a neighbour for a seed of many words", async () => {
    /**
     * The regression test. This is the case the old query could not
     * satisfy: ~40 distinct terms in the seed, a neighbour sharing perhaps
     * half of them, and nothing containing all of them.
     */
    const result = await findRelatedFiles({
      workspaceId,
      actor: actor(),
      resourceId: ids["ledger-a.txt"],
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "ledger-b.txt",
    );
  });

  it("does not relate a document that merely shares common words", async () => {
    /**
     * The other half of the bargain, and the failure that swapping AND for
     * OR would have introduced.
     *
     * The stored vectors use the `simple` dictionary, which strips no
     * stopwords, so "the", "and" and "for" are ordinary terms that both
     * documents contain. An unfiltered OR would relate the kitchen quotes
     * to the ledger memorandum through exactly those. Choosing the seed's
     * rarest terms is what prevents it.
     */
    const result = await findRelatedFiles({
      workspaceId,
      actor: actor(),
      resourceId: ids["ledger-a.txt"],
    });

    expect(result.items.map((item) => item.displayName)).not.toContain(
      "kitchen.txt",
    );
  });

  it("still relates in a workspace holding only two documents", async () => {
    /**
     * The smallest corpus that can have a neighbour at all, and the case
     * that caught a defect in the first version of this fix.
     *
     * That version excluded terms appearing in *every* document, as a
     * corpus-derived stopword filter. In a two-document workspace every
     * shared term appears in both, so the filter excluded all of them and
     * related was permanently empty — the exact failure being fixed,
     * reintroduced at a different corpus size and just as silent.
     */
    const solo = await prisma.user.create({
      data: {
        name: "Two doc owner",
        email: `related-two-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const soloWorkspace = await prisma.workspace.create({
      data: { userId: solo.id },
      select: { id: true },
    });
    const soloScope = await ensureEvidenceScope({
      workspaceId: soloWorkspace.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: solo.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = solo.id;
    workspaceId = soloWorkspace.id;
    scopeId = soloScope.id;
    const first = await seedResource("only-a.txt", LEDGER_A);
    await seedResource("only-b.txt", LEDGER_B);
    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: soloWorkspace.id,
      actor: { userId: solo.id, organizationId: null, kind: "interactive" },
      resourceId: first,
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "only-b.txt",
    );
  });

  it("never offers the seed as its own neighbour", async () => {
    const result = await findRelatedFiles({
      workspaceId,
      actor: actor(),
      resourceId: ids["ledger-a.txt"],
    });

    expect(result.items.map((item) => item.id)).not.toContain(
      ids["ledger-a.txt"],
    );
  });

  it("reports not-indexed rather than empty when there is no text", async () => {
    // A document with no chunks has no seed passages at all, which is a
    // different answer from "looked, found nobody" and is rendered
    // differently.
    const bare = await prisma.fileResource.create({
      data: {
        workspaceId,
        sourceKind: FileSourceKind.DRIVE_UPLOAD,
        sourceScope: FileSourceScope.USER,
        sourceId: `drive/users/${ownerId}/bare.bin`,
        ownerUserId: ownerId,
        displayName: "bare.bin",
        normalizedName: "bare.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 4,
        lifecycle: FileResourceLifecycle.ACTIVE,
        versions: {
          create: {
            revision: 1,
            objectKey: `drive/users/${ownerId}/bare.bin`,
            mimeType: "application/octet-stream",
            sizeBytes: 4,
          },
        },
      },
      select: { id: true },
    });

    const result = await findRelatedFiles({
      workspaceId,
      actor: actor(),
      resourceId: bare.id,
    });

    expect(result.state).toBe("not-indexed");
    expect(result.items).toHaveLength(0);
  });
});
