import type { ProjectSeoStrategy } from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoKeywordReach } from "./seo-keyword-reach";
import {
  SEO_RIVAL_ROWS_SHOWN,
  seoFeatureSearches,
  seoRivalLists,
} from "./seo-keyword-reach-model";
import { seoTestStrategy } from "./seo-test-fixture";

afterEach(cleanup);

type Strategy = NonNullable<ProjectSeoStrategy>;
type Host = NonNullable<Strategy["rivalKeywords"]>[number];
const row = (keyword: string, topic: boolean, volume = 10) => ({
  keyword,
  volume,
  position: 3,
  url: null,
  topic,
});
const host = (rows: Host["rows"], topicWords = ["battery"]): Host => ({
  host: "fiplab.com",
  total: 347,
  topicWords,
  rows,
});

describe("SEO keyword reach model", () => {
  it("lists a product's topic rows first and its other rows apart, each cut at the rows shown", () => {
    const many = (n: number, topic: boolean) =>
      Array.from({ length: n }, (_, i) => row(`${topic}-${i}`, topic));
    const lists = seoRivalLists(
      host([...many(12, true), ...many(3, false)].reverse()),
    );
    expect(lists.topic).toHaveLength(SEO_RIVAL_ROWS_SHOWN);
    expect(lists.topicMore).toBe(2);
    expect(lists.other.map((r) => r.keyword)).toEqual([
      "false-2",
      "false-1",
      "false-0",
    ]);
    expect(lists.otherMore).toBe(0);
    // Without topic words no row is marked, so every row is a topic row.
    const unmarked = seoRivalLists(host([row("clipboard", false)], []));
    expect(unmarked.topic.map((r) => r.keyword)).toEqual(["clipboard"]);
    expect(unmarked.other).toEqual([]);
  });

  it("names the suggestions read's searches only when they differ from the overview's", () => {
    expect(seoFeatureSearches({ volume: 50, demand: 30 })).toEqual({
      searches: 30,
      suggested: 50,
    });
    expect(seoFeatureSearches({ volume: 50, demand: 50 })).toEqual({
      searches: 50,
      suggested: null,
    });
    expect(seoFeatureSearches({ volume: 50, demand: null })).toEqual({
      searches: 50,
      suggested: null,
    });
  });
});

function renderReach(strategy: Strategy | null) {
  render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      formats={createFormats()}
      messages={messages}
    >
      <SeoKeywordReach strategy={strategy} />
    </NextIntlClientProvider>,
  );
}

describe("SEO keyword reach sections", () => {
  it("shows each section the audit holds as a closed line, in the owner's words", () => {
    renderReach({
      ...seoTestStrategy(),
      featureReach: [
        {
          feature: "80% charge limit",
          keyword: "macbook stop charging at 80",
          volume: 50,
          demand: 30,
          reach: "not determined",
          position: null,
          note: "fewer than 50 monthly searches: no SERP read",
        },
      ],
      rivalKeywords: [
        host(
          [
            row("battery health mac", true, 1300),
            row("shortcut for clipboard", false, 5400),
          ],
          ["macbook", "battery"],
        ),
      ],
      articleIdeas: [
        {
          topic: "how long should a macbook battery last",
          feature: "Cycle count",
          keyword: null,
          demand: null,
          reach: "open",
          position: 12,
          note: null,
          suggestions: null,
        },
      ],
    });
    const reach = screen.getByTestId("seo-feature-reach");
    expect(reach.hasAttribute("open")).toBe(false);
    expect(
      within(reach).getByText(
        "30 searches a month (50 in keyword suggestions) · Reach not determined",
      ),
    ).toBeTruthy();
    const rivals = screen.getByTestId("seo-rival-keywords");
    expect(
      within(rivals).getByText(
        "Keywords with a word of your topic (\u201cmacbook\u201d or \u201cbattery\u201d):",
      ),
    ).toBeTruthy();
    expect(within(rivals).getByText("battery health mac")).toBeTruthy();
    // The other products' rows stay apart, under their count.
    expect(
      within(rivals).getByText(
        "1 keyword has none of these words: other products of the site, or product names",
      ),
    ).toBeTruthy();
    expect(
      within(rivals).getByText("5,400 searches a month · position 3"),
    ).toBeTruthy();
    const ideas = screen.getByTestId("seo-article-ideas");
    expect(
      within(ideas).getByText("A forum in the results · position 12"),
    ).toBeTruthy();
  });

  it("names the topic words for a competing product with no row that holds one", () => {
    renderReach({
      ...seoTestStrategy(),
      rivalKeywords: [host([row("aldente", false, 900)])],
    });
    const rivals = screen.getByTestId("seo-rival-keywords");
    expect(
      within(rivals).getByText(
        "No keyword has a word of your topic (\u201cbattery\u201d).",
      ),
    ).toBeTruthy();
    expect(within(rivals).getByText("aldente")).toBeTruthy();
    // One topic word: the other rows' line names "this word", as the site report does (SEO bot B211).
    expect(
      within(rivals).getByText(
        "1 keyword does not have this word: other products of the site, or product names",
      ),
    ).toBeTruthy();
  });

  it("shows nothing for an audit without the sections", () => {
    renderReach(seoTestStrategy());
    expect(screen.queryByTestId("seo-feature-reach")).toBeNull();
    expect(screen.queryByTestId("seo-rival-keywords")).toBeNull();
    expect(screen.queryByTestId("seo-article-ideas")).toBeNull();
    renderReach({ ...seoTestStrategy(), articleIdeas: [], featureReach: [] });
    expect(screen.queryByTestId("seo-article-ideas")).toBeNull();
    expect(screen.queryByTestId("seo-feature-reach")).toBeNull();
    renderReach(null);
    expect(screen.queryByTestId("seo-article-ideas")).toBeNull();
  });
});
