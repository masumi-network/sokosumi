import { describe, expect, it } from "vitest";

import type { AskCompetitorModel } from "./model";
import type { NewsItem } from "./news";
import { pickNews } from "./news-pick";

const calendly = { name: "Calendly", websiteUrl: "https://calendly.com/" };

function item(n: number, overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    title: `Title ${n}`,
    url: `https://news.example.com/${n}`,
    publisher: "news.example.com",
    publishedAt: new Date("2026-11-12"),
    quote: `Passage ${n}`,
    ...overrides,
  };
}

function model(items: unknown[]) {
  const calls: string[] = [];
  const ask: AskCompetitorModel = async ({ prompt, schema }) => {
    calls.push(prompt);
    return { output: schema.parse({ items }), costUsd: 0.0006 };
  };
  return { ask, calls };
}

describe("pickNews", () => {
  it("keeps the events, worded by the model, with the article's own facts", async () => {
    const { ask, calls } = model([
      {
        n: 0,
        isNews: true,
        story: "ai notetaker launch",
        summary: "Calendly launched an AI notetaker",
      },
      { n: 1, isNews: false, story: "api question", summary: "" },
    ]);
    const { news, costUsd } = await pickNews(calendly, [item(0), item(1)], ask);
    expect(costUsd).toBe(0.0006);
    expect(news).toEqual([
      { ...item(0), summary: "Calendly launched an AI notetaker" },
    ]);
    expect(JSON.parse(calls[0] ?? "{}").results[1]).toEqual({
      n: 1,
      title: "Title 1",
      publisher: "news.example.com",
      date: "2026-11-12",
      passage: "Passage 1",
    });
  });

  it("keeps one article per event", async () => {
    const { ask } = model([
      {
        n: 0,
        isNews: true,
        story: "la cafe opening",
        summary: "Stumptown opened an LA cafe",
      },
      {
        n: 1,
        isNews: true,
        story: "LA cafe opening ",
        summary: "A new LA cafe opened",
      },
      { n: 2, isNews: true, story: "series b", summary: "Raised a Series B" },
    ]);
    const { news } = await pickNews(calendly, [item(0), item(1), item(2)], ask);
    expect(news.map((kept) => kept.url)).toEqual([
      "https://news.example.com/0",
      "https://news.example.com/2",
    ]);
  });

  it("ignores a number it never sent, a repeat and an empty line", async () => {
    const { ask } = model([
      { n: 7, isNews: true, story: "ghost", summary: "Not a candidate" },
      { n: 0, isNews: true, story: "launch", summary: "  " },
      { n: 1, isNews: true, story: "funding", summary: "Raised money" },
      {
        n: 1,
        isNews: true,
        story: "funding again",
        summary: "Raised money twice",
      },
    ]);
    const { news } = await pickNews(calendly, [item(0), item(1)], ask);
    expect(news.map((kept) => kept.summary)).toEqual(["Raised money"]);
  });

  it("keeps at most five and clips a long line", async () => {
    const candidates = Array.from({ length: 8 }, (_unused, n) => item(n));
    const { ask } = model(
      candidates.map((_candidate, n) => ({
        n,
        isNews: true,
        story: `story ${n}`,
        summary: "y".repeat(200),
      })),
    );
    const { news } = await pickNews(calendly, candidates, ask);
    expect(news).toHaveLength(5);
    expect(news[0]?.summary).toHaveLength(140);
  });

  it("asks nobody without candidates", async () => {
    const { ask, calls } = model([]);
    expect(await pickNews(calendly, [], ask)).toEqual({ news: [], costUsd: 0 });
    expect(calls).toHaveLength(0);
  });
});
