import { describe, expect, it } from "vitest";

import {
  CURATED_FILE_VOCABULARY,
  curatedFileVocabularyProblems,
  curatedFileVocabularyRows,
} from "./file-curated-vocabulary.js";

/**
 * The curated list is product data going in behind the route that would have
 * validated it, so the validation has to live here instead.
 *
 * `POST /v1/drive/labels` refuses an over-long name, a name containing markup,
 * a duplicate `(kind, normalizedName)` and a CATEGORY with no description. The
 * seed writes rows with `createMany`, which enforces none of that — so a
 * 300-character description or two entries normalizing to the same name would
 * ship as a failed migration or a silently truncated rubric.
 */
describe("the curated Files vocabulary", () => {
  it("would pass the rules the label route enforces", () => {
    expect(curatedFileVocabularyProblems()).toEqual([]);
  });

  it("fits the suggestion shortlist window with room to spare", () => {
    // SUGGESTION_VOCABULARY_MAX is 30 across both kinds with a floor of 10
    // each, so at 20 nothing is ever truncated and a workspace can still hand-
    // make ten labels before the model stops seeing all of them.
    const categories = CURATED_FILE_VOCABULARY.filter(
      (label) => label.kind === "CATEGORY",
    );
    const tags = CURATED_FILE_VOCABULARY.filter(
      (label) => label.kind === "TAG",
    );
    expect(categories).toHaveLength(8);
    expect(tags).toHaveLength(12);
    expect(CURATED_FILE_VOCABULARY.length).toBeLessThanOrEqual(30);
  });

  it("gives every entry a rubric, categories and tags alike", () => {
    // The description is what the model is scored against. A bare word is a
    // label it has to guess the meaning of, and the shortlist sends
    // descriptions for both kinds.
    for (const row of curatedFileVocabularyRows()) {
      expect(row.description.length, row.displayName).toBeGreaterThan(20);
    }
  });

  it("normalizes names the way the unique key compares them", () => {
    // The seed and the backfill both key on this, and the unique index is
    // (workspaceId, kind, normalizedName).
    const rows = curatedFileVocabularyRows();
    expect(
      rows.find((row) => row.displayName === "Invoice or receipt")
        ?.normalizedName,
    ).toBe("invoice or receipt");
    expect(
      new Set(rows.map((row) => `${row.kind}:${row.normalizedName}`)).size,
    ).toBe(rows.length);
  });
});
