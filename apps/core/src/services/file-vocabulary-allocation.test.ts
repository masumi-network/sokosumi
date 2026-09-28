import { describe, expect, it } from "vitest";

import {
  allocateVocabularySlots,
  SUGGESTION_KIND_FLOOR,
  SUGGESTION_VOCABULARY_MAX,
} from "./file-suggestions.service";

/**
 * Neither kind of label may starve the other.
 *
 * The shortlist was one query, `ORDER BY kind ASC, normalizedName ASC`
 * with `take: 30`. Postgres orders an enum by declaration order, and
 * `FileLabelKind` declares `TAG` before `CATEGORY` — verified against the
 * database, `TAG` sorts 1 and `CATEGORY` sorts 2 — so tags filled the
 * window. A workspace with 30 or more tags sent zero categories to the
 * evaluator and could never receive a category suggestion again. Nothing
 * caps label creation, so a workspace gets there by doing what the
 * product invites, and the reader sees "Uncategorized", which is also
 * what a document the model considered and declined looks like.
 *
 * Reversing the sort would be the same defect pointed the other way.
 */
describe("sharing the shortlist window between kinds", () => {
  it("asks about a category in a workspace full of tags", () => {
    // The regression, at the smallest shape that shows it: enough tags to
    // fill the window on their own, and one category. Before the fix the
    // category was never asked about.
    const slots = allocateVocabularySlots({ categories: 1, tags: 30 });

    expect(slots.categories).toBe(1);
    expect(slots.categories + slots.tags).toBeLessThanOrEqual(
      SUGGESTION_VOCABULARY_MAX,
    );
  });

  it("does not starve either kind, whichever one is larger", () => {
    for (const [categories, tags] of [
      [1, 500],
      [500, 1],
      [500, 500],
      [31, 31],
    ] as const) {
      const slots = allocateVocabularySlots({ categories, tags });

      expect(
        slots.categories,
        `categories with ${categories}/${tags}`,
      ).toBeGreaterThan(0);
      expect(slots.tags, `tags with ${categories}/${tags}`).toBeGreaterThan(0);
      expect(slots.categories + slots.tags).toBeLessThanOrEqual(
        SUGGESTION_VOCABULARY_MAX,
      );
    }
  });

  it("guarantees each kind its floor when both overflow", () => {
    const slots = allocateVocabularySlots({ categories: 500, tags: 500 });

    expect(slots.categories).toBeGreaterThanOrEqual(SUGGESTION_KIND_FLOOR);
    expect(slots.tags).toBeGreaterThanOrEqual(SUGGESTION_KIND_FLOOR);
  });

  it("reserves nothing for a kind that does not exist", () => {
    // A floor is a guarantee, not a reservation against thin air: with no
    // categories the window belongs to tags.
    const slots = allocateVocabularySlots({ categories: 0, tags: 500 });

    expect(slots.categories).toBe(0);
    expect(slots.tags).toBe(SUGGESTION_VOCABULARY_MAX);
    expect(slots.truncated).toBe("tags");
  });

  it("gives the larger set more of what is left over", () => {
    // Proportional, not equal: a workspace with four categories and five
    // hundred tags should spend most of the window on tags.
    const slots = allocateVocabularySlots({ categories: 4, tags: 500 });

    expect(slots.categories).toBe(4);
    expect(slots.tags).toBe(SUGGESTION_VOCABULARY_MAX - 4);
  });

  it("asks about everything when everything fits", () => {
    const slots = allocateVocabularySlots({ categories: 5, tags: 9 });

    expect(slots).toEqual({ categories: 5, tags: 9, truncated: "none" });
  });

  it("never asks about more than the window, at any mix", () => {
    /**
     * The invariant the request ceiling depends on. A shortlist larger
     * than the window is not a smaller failure than a starved kind: it
     * walks into `buildJevLabelRequest`'s refusal, which is silent.
     */
    for (let categories = 0; categories <= 60; categories += 1) {
      for (let tags = 0; tags <= 60; tags += 1) {
        const slots = allocateVocabularySlots({ categories, tags });

        expect(
          slots.categories + slots.tags,
          `overflowed at ${categories}/${tags}`,
        ).toBeLessThanOrEqual(SUGGESTION_VOCABULARY_MAX);
        // And it never invents labels a workspace does not have.
        expect(slots.categories).toBeLessThanOrEqual(categories);
        expect(slots.tags).toBeLessThanOrEqual(tags);
      }
    }
  });

  it("says which kinds were cut", () => {
    /**
     * Truncating 47 labels to 30 emitted nothing and the wave reported
     * success. Closed vocabulary: which kinds, not how many, and nothing
     * about the request.
     */
    expect(allocateVocabularySlots({ categories: 2, tags: 3 }).truncated).toBe(
      "none",
    );
    expect(
      allocateVocabularySlots({ categories: 2, tags: 500 }).truncated,
    ).toBe("tags");
    expect(
      allocateVocabularySlots({ categories: 500, tags: 2 }).truncated,
    ).toBe("categories");
    expect(
      allocateVocabularySlots({ categories: 500, tags: 500 }).truncated,
    ).toBe("both");
  });
});
