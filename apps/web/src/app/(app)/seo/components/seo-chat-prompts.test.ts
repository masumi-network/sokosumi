import { describe, expect, it } from "vitest";
import {
  type SeoChatPrompt,
  seoAgentPrompts,
  seoChatSuggestions,
} from "./seo-chat-prompts";

const textOf = (prompt: SeoChatPrompt) => `q:${prompt}`;
const data = { competitors: true, searches: false, unranked: true };

describe("SEO agent example questions", () => {
  it("offers only questions the saved data can answer", () => {
    // No search statistics: the question about searches has no answer, so the one about keywords stands in.
    expect(
      seoAgentPrompts({ competitors: true, searches: false, unranked: false }),
    ).toEqual(["first", "track", "competitors"]);
    expect(
      seoAgentPrompts({ competitors: false, searches: true, unranked: false }),
    ).toEqual(["first", "queries"]);
    // No keyword in Google's top results: the question about that result stands in for "what first".
    expect(
      seoAgentPrompts({ competitors: true, searches: false, unranked: true }),
    ).toEqual(["unranked", "track", "competitors"]);
  });
});

describe("SEO chat suggestions", () => {
  it("offers the starters in an empty thread", () => {
    expect(seoChatSuggestions({ ...data, asked: [], textOf })).toEqual([
      "unranked",
      "track",
      "competitors",
    ]);
  });

  it("follows on from the newest question and drops the questions asked", () => {
    expect(
      seoChatSuggestions({ ...data, asked: ["q:unranked"], textOf }),
    ).toEqual(["whichPage", "howLong", "track"]);
    expect(
      seoChatSuggestions({
        ...data,
        asked: ["q:unranked", "q:whichPage", " q:track "],
        textOf,
      }),
    ).toEqual(["whyKeywords", "competitors"]);
  });

  it("keeps the other follow-ups of a starter after one of them", () => {
    expect(
      seoChatSuggestions({
        competitors: true,
        searches: false,
        unranked: false,
        asked: ["q:first", "q:howToDo"],
        textOf,
      }),
    ).toEqual(["whyFirst", "track", "competitors"]);
  });

  it("offers plainer words after a typed question, once", () => {
    expect(
      seoChatSuggestions({ ...data, asked: ["Why is my title long?"], textOf }),
    ).toEqual(["simpler", "unranked", "track"]);
    expect(
      seoChatSuggestions({
        ...data,
        asked: ["Why is my title long?", "q:simpler"],
        textOf,
      }),
    ).toEqual(["unranked", "track", "competitors"]);
  });

  it("offers fewer suggestions when few are left", () => {
    expect(
      seoChatSuggestions({
        competitors: false,
        searches: false,
        unranked: false,
        asked: ["q:first", "q:howToDo", "q:whyFirst", "q:track"],
        textOf,
      }),
    ).toEqual(["whyKeywords"]);
  });
});
