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

  it("relates on a single rare shared term at the full seed-term limit", async () => {
    /**
     * The band the rank floor was silently eating.
     *
     * `ts_rank` over an OR query divides by the number of OR-ed terms, so
     * a neighbour matching exactly one of eight scored 0.0076 against a
     * fixed floor of 0.01 and was dropped, while the same neighbour in a
     * two-term query scored 0.0304 and was kept. Nobody chose that: the
     * constant changed meaning with the seed's vocabulary breadth.
     *
     * A distant-but-genuine neighbour is what this feature is *for*, and
     * `docs ASC` biases term selection toward rare words, which makes
     * single-term overlap the expected case rather than the edge one.
     *
     * Two things have to hold for this to be the test it claims to be, so
     * both are asserted below rather than assumed: the query really is
     * eight terms wide, and the neighbour really shares exactly one of
     * them. Getting that fixture right is most of the work — the first
     * version shared a term that `docs ASC` ranked last and never put it
     * in the query at all.
     *
     * Reverting either half turns this red: the term-count normalisation
     * in the HAVING clause, or the rare-term escape beside it.
     */
    const owner = await prisma.user.create({
      data: {
        name: "Single overlap owner",
        email: `related-single-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const evidence = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = owner.id;
    workspaceId = space.id;
    scopeId = evidence.id;

    /**
     * `common` goes in most of the workspace, so those terms sort *after*
     * the rare one and fill the remaining seven slots. `zarbrinth` is in
     * the seed and one other document only, which makes it both eligible
     * (`docs > 1`) and the rarest thing the seed has.
     */
    const COMMON =
      "quarterly departmental summary prepared against the standing " +
      "reporting calendar for circulation to the committee members";
    const seed = await seedResource(
      "rare-seed.txt",
      `${COMMON} and the zarbrinth position specifically`,
    );
    /**
     * Three, not more. They exist to make the common vocabulary common
     * and to push the corpus above the rarity threshold; beyond that they
     * are competitors, and `RELATED_RESULT_LIMIT` is 6, so a crowd of
     * strong neighbours pushes the one being tested off the end and the
     * test fails for a reason that has nothing to do with the fix.
     */
    for (let index = 0; index < 3; index += 1) {
      await seedResource(`filler-${index}.txt`, `${COMMON} number ${index}`);
    }
    // Shares `zarbrinth` with the seed and none of the common vocabulary.
    await seedResource(
      "single-overlap.txt",
      "Unrelated subject matter mentioning zarbrinth once, with no other " +
        "word this document has in common with its neighbour.",
    );

    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: space.id,
      actor: { userId: owner.id, organizationId: null, kind: "interactive" },
      resourceId: seed,
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "single-overlap.txt",
    );
  });

  it("chooses the seed's rarer terms over its longer ones", async () => {
    /**
     * `docs ASC` — the document-frequency ordering, which the commit that
     * introduced it called the working defence and the reason this is not
     * a bare AND-to-OR swap. A reviewer deleted that one clause and the
     * whole suite stayed green: with it gone the rule becomes "the eight
     * longest words" and nothing noticed. The AND-versus-OR test does not
     * cover it, because it tests AND versus OR.
     *
     * So this pins the ordering directly, through its consequence. The
     * seed carries a rare short word and several long words that every
     * document has. Ordering by frequency picks the short rare one and
     * finds the neighbour that shares it; ordering by length picks the
     * long common ones, whose neighbours are everybody, and the
     * distinctive match is crowded out of a six-item list.
     */
    const owner = await prisma.user.create({
      data: {
        name: "Frequency ordering owner",
        email: `related-df-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const evidence = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = owner.id;
    workspaceId = space.id;
    scopeId = evidence.id;

    /**
     * Every word here is longer than the rare term, and every one of them
     * is in all of the bulk documents below. Length ordering prefers
     * them; frequency ordering puts them last.
     */
    const LONG_AND_COMMON = [
      "interdepartmental correspondence regarding administrative",
      "reorganisation throughout the consolidated infrastructure",
      "programme documentation supplementary appendices",
    ].join(" ");

    const seed = await seedResource(
      "df-seed.txt",
      `${LONG_AND_COMMON} plus obex.`,
    );
    for (let index = 0; index < 3; index += 1) {
      await seedResource(
        `df-bulk-${index}.txt`,
        `${LONG_AND_COMMON} variation ${index}`,
      );
    }
    // Shares only the short, rare word.
    await seedResource(
      "df-rare-match.txt",
      "A note about obex and nothing else whatsoever in it.",
    );

    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: space.id,
      actor: { userId: owner.id, organizationId: null, kind: "interactive" },
      resourceId: seed,
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "df-rare-match.txt",
    );
  });

  it("does not offer a neighbour that matched one ordinary word", async () => {
    /**
     * The rank floor, which a reviewer raised from 0.01 to 0.05 without
     * reddening anything. Nothing pinned it, so it could be any number.
     *
     * The case it has to decide: a neighbour sharing exactly one term
     * that is *not* rare. On the normalised scale that is 0.0608, against
     * a floor of 0.09, so it is refused — while the rare-term escape in
     * the same HAVING clause lets the previous test's genuine match
     * through. Both halves have to hold or the constant is arbitrary
     * again.
     *
     * Lowering the floor below 0.0608 turns this red. The upper bound is
     * pinned by the test after this one, not by the two-document test —
     * an earlier version of this comment claimed otherwise and a mutant
     * disproved it: the two-document neighbour shares most of the seed's
     * vocabulary and stays well above any floor worth considering.
     */
    const owner = await prisma.user.create({
      data: {
        name: "Floor owner",
        email: `related-floor-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const evidence = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = owner.id;
    workspaceId = space.id;
    scopeId = evidence.id;

    // Shared by the seed and its twin, so every one of them is eligible
    // and none is rare enough to carry a match on its own.
    // Exactly RELATED_SEED_TERM_LIMIT words, so every one of them is
    // chosen and the match count is the only variable left. With nine,
    // `docs ASC` drops whichever term the candidate shares and the test
    // measures term selection instead of the floor.
    const SHARED =
      "settlement reconciliation variance ledger committee schedule " +
      "appendix residual";
    const seed = await seedResource("floor-seed.txt", SHARED);
    await seedResource("floor-twin.txt", SHARED);
    // Exactly one ordinary shared word, and it is not rare: it is in
    // three of the four documents here.
    await seedResource(
      "floor-brush.txt",
      "Kitchen worktop delivery and the extractor hood, plus one " +
        "settlement of the invoice.",
    );

    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: space.id,
      actor: { userId: owner.id, organizationId: null, kind: "interactive" },
      resourceId: seed,
    });

    expect(result.items.map((item) => item.displayName)).toContain(
      "floor-twin.txt",
    );
    expect(result.items.map((item) => item.displayName)).not.toContain(
      "floor-brush.txt",
    );
  });

  it("offers a neighbour that matched two ordinary words", async () => {
    /**
     * The floor's upper bound, which nothing pinned: raising it from 0.09
     * to 0.15 left the whole suite green, so the number could have been
     * anything above the single-match case.
     *
     * Two ordinary matches measure 0.1216 on the normalised scale. That
     * is the weakest neighbour the feature should still offer when no
     * rare term is involved — a real but modest overlap — so it is the
     * case that fixes the ceiling. Together with the test above, the
     * constant is now bounded on both sides by measurement rather than
     * chosen.
     */
    const owner = await prisma.user.create({
      data: {
        name: "Ceiling owner",
        email: `related-ceiling-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const evidence = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = owner.id;
    workspaceId = space.id;
    scopeId = evidence.id;

    // Exactly RELATED_SEED_TERM_LIMIT words, so every one of them is
    // chosen and the match count is the only variable left. With nine,
    // `docs ASC` drops whichever term the candidate shares and the test
    // measures term selection instead of the floor.
    const SHARED =
      "settlement reconciliation variance ledger committee schedule " +
      "appendix residual";
    const seed = await seedResource("ceiling-seed.txt", SHARED);
    // Keeps every seed term eligible without being the answer.
    await seedResource("ceiling-twin.txt", SHARED);
    // Exactly two of the seed's ordinary terms, and no rare one.
    await seedResource(
      "ceiling-pair.txt",
      "A note on the settlement and the variance, concerning a kitchen " +
        "worktop and an extractor hood delivered last month.",
    );

    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: space.id,
      actor: { userId: owner.id, organizationId: null, kind: "interactive" },
      resourceId: seed,
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "ceiling-pair.txt",
    );
  });

  it("does not let the seed's own vocabulary fill the seed-term slots", async () => {
    /**
     * The probe counted matching **chunks** while everything that
     * consumed the number reasoned in **documents**.
     *
     * `docs > 1` is meant to say "some other document has this word", and
     * the rarity test compares `docs` against a corpus counted in
     * documents. But with `FILE_CHUNK_OVERLAP_CHARS` at 240, a word
     * appearing twice in one long file lands in two chunks, so a term the
     * seed alone contains reported `docs = 2`, passed the filter designed
     * to exclude exactly that, and sorted *first* under `docs ASC`. The
     * seed competed with itself for the eight slots, and it won.
     *
     * Measured on a realistic fixture: five of eight slots went to words
     * present only in the seed, four of them additionally flagged rare,
     * leaving three for the shared vocabulary that could actually match a
     * neighbour. Counting documents gives all eight to shared terms.
     *
     * The fixture below makes that the difference between finding the
     * neighbour and not. The seed carries ten private words, each twice
     * so each spans more than one chunk, and one genuinely shared term.
     * Counting chunks fills every slot with the private words and the
     * shared term never enters the query.
     */
    const owner = await prisma.user.create({
      data: {
        name: "Units owner",
        email: `related-units-${suffix}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const space = await prisma.workspace.create({
      data: { userId: owner.id },
      select: { id: true },
    });
    const evidence = await ensureEvidenceScope({
      workspaceId: space.id,
      sourceKind: FileSourceKind.DRIVE_UPLOAD,
      sourceScope: FileSourceScope.USER,
      sourceId: owner.id,
    });

    const previousOwner = ownerId;
    const previousWorkspace = workspaceId;
    const previousScope = scopeId;
    ownerId = owner.id;
    workspaceId = space.id;
    scopeId = evidence.id;

    const padding = "padding ".repeat(300);
    const privates = Array.from(
      { length: 10 },
      (_, index) => `solitaryterm${index}`,
    );
    // Each private word twice, far apart, so it spans chunks — one
    // document, two chunks, which is the whole confusion.
    const seedText = [
      privates.join(" "),
      padding,
      privates.join(" "),
      padding,
      // Two, not one. One ordinary shared term scores 0.0608 against a
      // floor of 0.09 and is refused on the merits, which would make this
      // test fail for a reason that has nothing to do with units.
      "quorumbearing tesselwright",
    ].join(" ");

    const seed = await seedResource("units-seed.txt", seedText);
    // Shares the one term and nothing else.
    await seedResource(
      "units-neighbour.txt",
      "A separate note whose only overlap with the seed is quorumbearing and tesselwright.",
    );
    // Enough others carrying the shared term that it is ordinary rather
    // than rare, so this tests term *selection* and not the rare escape.
    for (let index = 0; index < 5; index += 1) {
      await seedResource(
        `units-filler-${index}.txt`,
        `Routine quorumbearing tesselwright filler number ${index}.`,
      );
    }

    ownerId = previousOwner;
    workspaceId = previousWorkspace;
    scopeId = previousScope;

    const result = await findRelatedFiles({
      workspaceId: space.id,
      actor: { userId: owner.id, organizationId: null, kind: "interactive" },
      resourceId: seed,
    });

    expect(result.state).toBe("ok");
    expect(result.items.map((item) => item.displayName)).toContain(
      "units-neighbour.txt",
    );
  });
});
