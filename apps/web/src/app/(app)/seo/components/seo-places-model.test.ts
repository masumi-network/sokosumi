import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoPlaces, seoStrategyRows } from "./seo-places-model";

type Action = ProjectSeoStrategy["actions"][number];

const action = (patch: Partial<Action>): Action => ({
  kind: "promote",
  title: "Present the product in r/macbook",
  why: "3 threads of r/macbook are in 4 of 23 SERP reads for keywords the site does not rank for.",
  expectedEffect: "People can learn about the product.",
  effort: "low",
  limit: null,
  targets: [],
  ...patch,
});
const target = (
  url: string,
  type: string,
  serps: number | null,
  state: string | null = "not mentioned",
) => ({ url, title: url, type, serps, state });

describe("SEO places to get links", () => {
  it("puts the places that the owner gets onto alone first, then the ones more searches show", () => {
    const { places, rest } = seoPlaces([
      action({
        kind: "get listed",
        title: "Ask to be added to these lists of products",
        why: "3 lists of products are in the top 10 of the start page's 23 SERP reads.",
        targets: [
          target("https://lists.test/a", "listicle", 6),
          target(
            "https://lists.test/b",
            "listicle",
            2,
            "mentioned without a link",
          ),
          // Links to the site already: nothing to ask.
          target("https://lists.test/c", "listicle", 9, "links"),
        ],
      }),
      action({ kind: "new page", title: "Write a guide" }),
      action({
        kind: "get listed",
        title: "List the product in these software directories",
        why: "1 software directory is in the top 10 of the start page's 23 SERP reads.",
        // An older row has no count.
        targets: [target("https://dir.test/", "directory", null, null)],
      }),
      action({
        place: {
          name: "r/macbook",
          url: "https://reddit.com/r/macbook",
          form: "community",
        },
        draft: "Hello",
      }),
      action({
        title: "Present the product in forums.macrumors.com",
        why: "9 threads of forums.macrumors.com (5 shown) are in 11 of 23 SERP reads for keywords the site does not rank for.",
        place: {
          name: "forums.macrumors.com",
          url: "https://forums.macrumors.com/",
          form: "community",
        },
        draft: "Hello",
      }),
      action({
        title: "Answer a question on quora.com that the product solves",
        why: "9 threads of quora.com are in 10 of 23 SERP reads.",
        place: {
          name: "quora.com",
          url: "https://quora.com/",
          form: "community",
        },
      }),
      action({
        kind: "get listed",
        why: "1 page is in the top 10 of the start page's 23 SERP reads.",
        // A kind of page this does not know does not rank as easy.
        targets: [target("https://odd.test/", "other", 1)],
      }),
      action({
        title: "Present the product in a post on X",
        why: "",
        place: { name: "X", url: "https://x.com/", form: "post" },
      }),
    ]);
    expect(
      places.map(({ name, ease, reason, reads }) => [
        name,
        ease,
        reason,
        reads && `${reads.seen}/${reads.total}`,
      ]),
    ).toEqual([
      ["forums.macrumors.com", "easy", "text", "11/23"],
      ["r/macbook", "easy", "text", "4/23"],
      // No count: after the counted places of its ease, in the bot's order.
      ["https://dir.test/", "easy", "self", null],
      ["X", "easy", "self", null],
      ["https://lists.test/b", "medium", "mention", "2/23"],
      ["quora.com", "hard", "answer", "10/23"],
      ["https://lists.test/a", "hard", "author", "6/23"],
      ["https://odd.test/", "hard", "author", "1/23"],
    ]);
    // A page row is its own action: one target, and no reason about all pages of its kind.
    expect(places[6].action.targets.map((page) => page.url)).toEqual([
      "https://lists.test/a",
    ]);
    expect(places[6].action.why).toBe("");
    expect(rest.map((row) => row.title)).toEqual(["Write a guide"]);
  });

  it("counts a community's searches without the audit's own forum searches, and one SERP without a number", () => {
    const { places } = seoPlaces([
      action({
        why: '4 threads of r/a are in 8 of 25 SERP reads for keywords the site does not rank for. 6 of these reads are the audit\'s own searches for such a keyword with "forum" or "reddit" added.',
        place: {
          name: "r/a",
          url: "https://reddit.com/r/a",
          form: "community",
        },
        draft: "Hello",
      }),
      action({
        why: '1 thread of r/b is in 2 of 25 SERP reads for keywords the site does not rank for. 2 of these reads are the audit\'s own searches for such a keyword with "forum" or "reddit" added.',
        place: {
          name: "r/b",
          url: "https://reddit.com/r/b",
          form: "community",
        },
        draft: "Hello",
      }),
      action({
        kind: "get listed",
        why: "1 software directory is in the top 10 of the start page's SERP read.",
        targets: [target("https://dir.test/", "directory", 1, null)],
      }),
    ]);
    expect(
      places.map(({ name, reads }) => [
        name,
        reads && `${reads.seen}/${reads.total}`,
      ]),
    ).toEqual([
      ["r/a", "2/19"],
      ["https://dir.test/", "1/1"],
      // Found only by the audit's own searches: no count.
      ["r/b", null],
    ]);
  });

  it("keeps a listing without pages as an action, and ranks by the count of searches, not by a share", () => {
    const { places, rest } = seoPlaces([
      action({
        kind: "get listed",
        title: "Create a Google Business Profile",
        why: "People search for the business on Maps.",
      }),
      // 4 of 10 reads of keywords the site does not rank for: a larger share, fewer searches.
      action({
        why: "2 threads of r/a are in 4 of 10 SERP reads for keywords the site does not rank for.",
        place: {
          name: "r/a",
          url: "https://reddit.com/r/a",
          form: "community",
        },
        draft: "Hello",
      }),
      action({
        kind: "get listed",
        why: "1 software directory is in the top 10 of the start page's 23 SERP reads.",
        targets: [target("https://dir.test/", "directory", 6, null)],
      }),
      // A picked niche names one SERP and no count.
      action({
        kind: "get listed",
        why: 'The SERP for "battery app" lists 1 software directory.',
        targets: [target("https://other-dir.test/", "directory", 1, null)],
      }),
    ]);
    expect(rest.map((row) => row.title)).toEqual([
      "Create a Google Business Profile",
    ]);
    expect(
      places.map(({ name, reads }) => [name, reads && reads.seen]),
    ).toEqual([
      ["https://dir.test/", 6],
      ["r/a", 4],
      ["https://other-dir.test/", null],
    ]);
  });

  it("gives no count that the reason does not hold, and counts the rows that lead to the list", () => {
    const { places } = seoPlaces([
      action({ why: "The start page says so." }),
      action({
        kind: "get listed",
        why: "2 lists of products are in the top 10.",
        targets: [target("https://lists.test/a", "listicle", 2)],
      }),
    ]);
    expect(places.map((place) => place.reads)).toEqual([null, null]);
    expect(
      seoStrategyRows({
        actions: [
          action({ kind: "new page" }),
          // Counted as an action: it has no page row.
          action({ kind: "get listed", targets: [] }),
          action({
            kind: "get listed",
            targets: [
              target("https://a.test/", "directory", 1),
              target("https://b.test/", "directory", 1, "links"),
            ],
          }),
        ],
      } as ProjectSeoStrategy),
    ).toBe(3);
    expect(seoStrategyRows(null)).toBe(0);
  });
});
