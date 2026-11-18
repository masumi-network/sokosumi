import { FileLabelKind } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/** Labels one request may ask about, so the shortlist is deterministic. */
export const SUGGESTION_VOCABULARY_MAX = 40;

/**
 * Slots each kind keeps even when the other has more labels than the
 * window.
 *
 * The shortlist was one query, `ORDER BY kind ASC, normalizedName ASC`
 * with `take: 30`. Postgres orders an enum by *declaration* order, and
 * `FileLabelKind` declares `TAG` before `CATEGORY`, so tags sorted first
 * and filled the window. A workspace with 30 or more tags sent **zero**
 * categories to the evaluator and could never receive a category
 * suggestion again — while the reader saw "Uncategorized", which is also
 * what a document the model considered and declined looks like.
 *
 * Nothing caps label creation, so a workspace reaches that by doing what
 * the product invites.
 *
 * Reversing the sort would have been the same defect pointed the other
 * way: categories would then starve tags. Reordering the enum would have
 * fixed this query by accident, as a migration against live data, while
 * leaving every other `ORDER BY kind` silently dependent on the new
 * order. So the query allocates instead.
 *
 * **What happens when one kind alone exceeds the window.** Each kind is
 * guaranteed this many slots, or all it has if it has fewer. Whatever is
 * left over is shared out in proportion to what each kind still has
 * waiting, so the larger set gets more of the remainder without the
 * smaller one ever reaching zero. A workspace with 500 tags and 4
 * categories asks about all 4 categories and 26 tags; one with 500 tags
 * and 500 categories asks about 15 of each; one with 500 tags and no
 * categories asks about 30 tags, because a floor reserves nothing for a
 * kind that does not exist.
 */
export const SUGGESTION_KIND_FLOOR = 10;

/** Which kinds, if any, had labels that did not fit the window. */
export type VocabularyTruncation = "none" | "tags" | "categories" | "both";

export interface VocabularySlots {
  categories: number;
  tags: number;
  truncated: VocabularyTruncation;
}

/**
 * Share the shortlist window between the two kinds.
 *
 * Exported because it is the whole of the fix and it is pure: the query
 * around it is two `findMany` calls, and everything that could go wrong
 * with starving a kind is decidable from two counts.
 *
 * The rule, in order:
 *
 * 1. Each kind is guaranteed `SUGGESTION_KIND_FLOOR` slots, or all it has
 *    if it has fewer. A kind with nothing reserves nothing.
 * 2. What is left is shared in proportion to what each kind still has
 *    waiting, so a much larger set gets most of the remainder.
 * 3. Any slot left by rounding goes to categories, which are the smaller
 *    and more consequential set — a document has one category and many
 *    tags, so a missing category is more visible than a missing tag.
 */
export function allocateVocabularySlots(input: {
  categories: number;
  tags: number;
}): VocabularySlots {
  const window = SUGGESTION_VOCABULARY_MAX;
  const { categories: haveCategories, tags: haveTags } = input;

  if (haveCategories + haveTags <= window) {
    return { categories: haveCategories, tags: haveTags, truncated: "none" };
  }

  let categories = Math.min(haveCategories, SUGGESTION_KIND_FLOOR);
  let tags = Math.min(haveTags, SUGGESTION_KIND_FLOOR);

  const spare = window - categories - tags;
  const categoriesWaiting = haveCategories - categories;
  const tagsWaiting = haveTags - tags;
  const waiting = categoriesWaiting + tagsWaiting;

  if (spare > 0 && waiting > 0) {
    // Rounded down so the two shares can never exceed the window; the
    // remainder is handed out below.
    const categoryShare = Math.min(
      categoriesWaiting,
      Math.floor((spare * categoriesWaiting) / waiting),
    );
    const tagShare = Math.min(
      tagsWaiting,
      Math.floor((spare * tagsWaiting) / waiting),
    );
    categories += categoryShare;
    tags += tagShare;

    let remainder = window - categories - tags;
    // Categories first, then tags, and only as far as each can use.
    const extraCategories = Math.min(remainder, haveCategories - categories);
    categories += extraCategories;
    remainder -= extraCategories;
    tags += Math.min(remainder, haveTags - tags);
  }

  const cutCategories = categories < haveCategories;
  const cutTags = tags < haveTags;

  return {
    categories,
    tags,
    truncated:
      cutCategories && cutTags
        ? "both"
        : cutCategories
          ? "categories"
          : cutTags
            ? "tags"
            : "none",
  };
}
export async function loadFileSuggestionVocabulary(
  workspaceId: string,
  rejectedLabelIds: ReadonlySet<string>,
) {
  /**
   * One query per kind, so neither can consume the other's slots.
   *
   * Each asks for a full window: the allocation below needs to know how
   * many each kind *has* before it can decide how many each kind gets,
   * and asking for one more than the window is what tells it a kind was
   * cut at all.
   */
  const byKind = await Promise.all(
    [FileLabelKind.CATEGORY, FileLabelKind.TAG].map(async (kind) => ({
      kind,
      entries: await prisma.workspaceLabel.findMany({
        where: {
          workspaceId,
          isTaskPreset: false,
          archivedAt: null,
          mergedIntoId: null,
          kind,
          id: { notIn: [...rejectedLabelIds] },
        },
        orderBy: [{ normalizedName: "asc" }],
        take: SUGGESTION_VOCABULARY_MAX + 1,
        select: {
          id: true,
          kind: true,
          displayName: true,
          description: true,
          vocabularyVersion: true,
        },
      }),
    })),
  );

  const available = new Map(byKind.map((row) => [row.kind, row.entries]));
  const allocation = allocateVocabularySlots({
    categories: available.get(FileLabelKind.CATEGORY)?.length ?? 0,
    tags: available.get(FileLabelKind.TAG)?.length ?? 0,
  });

  const vocabulary = [
    ...(available.get(FileLabelKind.CATEGORY) ?? []).slice(
      0,
      allocation.categories,
    ),
    ...(available.get(FileLabelKind.TAG) ?? []).slice(0, allocation.tags),
  ];

  return { vocabulary, allocation };
}
