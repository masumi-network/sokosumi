import { describe, expect, it } from "vitest";

import {
  canonicalNewsUrl,
  competitorNews,
  type NewsCandidate,
  quoteSentence,
} from "./news";

const window = {
  since: new Date("2026-11-10T00:00:00Z"),
  now: new Date("2026-11-17T12:00:00Z"),
};
const calendly = { name: "Calendly", websiteUrl: "https://calendly.com" };

function candidate(overrides: Partial<NewsCandidate>): NewsCandidate {
  return {
    title: "Calendly launches AI notetaker for sales teams",
    url: "https://techcrunch.com/2026/11/12/calendly-ai-notetaker",
    publishedDate: "2026-11-12",
    passages: ["Calendly said the notetaker is available on all paid plans."],
    ...overrides,
  };
}

describe("competitorNews", () => {
  it("keeps a dated article that names the competitor, with its own words", () => {
    expect(competitorNews(calendly, [candidate({})], window)).toEqual([
      {
        title: "Calendly launches AI notetaker for sales teams",
        url: "https://techcrunch.com/2026/11/12/calendly-ai-notetaker",
        publisher: "techcrunch.com",
        publishedAt: new Date("2026-11-12"),
        quote: "Calendly said the notetaker is available on all paid plans.",
      },
    ]);
  });

  it.each([
    ["a review site", { url: "https://www.g2.com/products/calendly/reviews" }],
    [
      "a subdomain of a job board",
      { url: "https://boards.greenhouse.io/calendly/jobs/1" },
    ],
    [
      "a social post",
      { url: "https://www.linkedin.com/posts/calendly_launch" },
    ],
    ["a listicle", { title: "10 best Calendly alternatives in 2026" }],
    ["a comparison", { title: "Calendly vs SavvyCal: which one wins" }],
    ["a top tools list", { title: "Top 7 scheduling tools for agencies" }],
    ["its own job ad", { url: "https://calendly.com/careers/senior-designer" }],
    ["a hiring announcement", { title: "Calendly is hiring a Head of Brand" }],
    [
      "a job on a job board",
      { url: "https://workpivot.online/remote-jobs/lead-pm-calendly" },
    ],
    ["a how-to", { title: "How to connect Calendly to your CRM" }],
    ["a question page", { title: "Does Calendly have an API?" }],
    ["a guide", { title: "Calendly integration: step-by-step guide" }],
    ["an article without a date", { publishedDate: undefined }],
    ["an article older than a week", { publishedDate: "2026-10-30" }],
    ["an article dated in the future", { publishedDate: "2026-12-01" }],
    [
      "an article that never names it",
      {
        title: "Scheduling software market grows",
        passages: ["Analysts expect more consolidation."],
      },
    ],
  ])("drops %s", (_label, overrides) => {
    expect(competitorNews(calendly, [candidate(overrides)], window)).toEqual(
      [],
    );
  });

  it("keeps news whose headline says review or deal", () => {
    expect(
      competitorNews(
        calendly,
        [
          candidate({ title: "Calendly closes deal with Salesforce" }),
          candidate({
            title: "Calendly reviews its pricing after user pushback",
            url: "https://techcrunch.com/calendly-pricing-review",
          }),
        ],
        window,
      ),
    ).toHaveLength(2);
  });

  it("keeps a headline that opens with a question", () => {
    expect(
      competitorNews(
        calendly,
        [candidate({ title: "Is SaaS dead? Calendly bets on AI agents" })],
        window,
      ),
    ).toHaveLength(1);
  });

  it("keeps the competitor's own launch post", () => {
    const [item] = competitorNews(
      calendly,
      [
        candidate({
          title: "Introducing routing for teams",
          url: "https://calendly.com/blog/routing-for-teams?utm_source=x",
          passages: ["Routing sends each lead to the right rep."],
        }),
      ],
      window,
    );
    expect(item?.url).toBe("https://calendly.com/blog/routing-for-teams");
    expect(item?.publisher).toBe("calendly.com");
  });

  it("keeps one of a story that two addresses or two sites carry", () => {
    const items = competitorNews(
      calendly,
      [
        candidate({}),
        candidate({
          url: "https://www.techcrunch.com/2026/11/12/calendly-ai-notetaker/?utm_campaign=feed",
        }),
        candidate({ url: "https://news.example.com/calendly-ai-notetaker" }),
      ],
      window,
    );
    expect(items).toHaveLength(1);
  });

  it("matches a name with punctuation by its letters, not a longer word", () => {
    const calcom = { name: "Cal.com", websiteUrl: "https://cal.com" };
    expect(
      competitorNews(
        calcom,
        [
          candidate({
            title: "Cal.com raises a Series B",
            url: "https://techcrunch.com/cal-series-b",
            passages: [],
          }),
          candidate({
            title: "Calendar apps are changing",
            url: "https://example.com/calendar-apps",
            passages: ["A calendar is not a product."],
          }),
        ],
        window,
      ).map((item) => item.title),
    ).toEqual(["Cal.com raises a Series B"]);
  });

  it("returns at most ten", () => {
    const many = Array.from({ length: 14 }, (_unused, index) =>
      candidate({
        title: `Calendly ships update number ${index}`,
        url: `https://techcrunch.com/calendly-${index}`,
      }),
    );
    expect(competitorNews(calendly, many, window)).toHaveLength(10);
  });
});

describe("canonicalNewsUrl", () => {
  it("drops tracking, the fragment, a trailing slash and www", () => {
    expect(
      canonicalNewsUrl(
        "http://www.Example.com/story/?utm_source=x&id=7&fbclid=abc#top",
      ),
    ).toBe("http://example.com/story?id=7");
  });

  it("refuses what is not a web address", () => {
    expect(canonicalNewsUrl("mailto:press@example.com")).toBeNull();
    expect(canonicalNewsUrl("not a url")).toBeNull();
  });
});

describe("quoteSentence", () => {
  const names = ["calendly", "calendlycom"];

  it("takes the sentence that names the company, not the page around it", () => {
    expect(
      quoteSentence(
        "New: Email Callie your scheduling requests directly | Community roman Employee 3 days ago Nov 12, 2026 5:00 PM UTC # New: Email Callie # You can now email Callie. Calendly reads the request and books the meeting for you. Try it today.",
        names,
      ),
    ).toBe("Calendly reads the request and books the meeting for you.");
  });

  it("falls back to the first real sentence", () => {
    expect(
      quoteSentence(
        "By Kai · Nov 16 ... Coffee shops are helping people get to the polls this year.",
        names,
      ),
    ).toBe("Coffee shops are helping people get to the polls this year.");
  });

  it("drops the dateline a page prints before its first sentence", () => {
    expect(
      quoteSentence(
        "Tue, 11/17/2026 - 12:00 November 17, 2026 Calendly Pro users at UCR, Calendly is phasing out the Pro plan in December.",
        names,
      ),
    ).toBe(
      "Calendly Pro users at UCR, Calendly is phasing out the Pro plan in December.",
    );
    expect(
      quoteSentence(
        "13, 2026 /PRNewswire/ -- Ranger Chocolate invites neighbours to a tasting at Calendly's new cafe.",
        names,
      ),
    ).toBe(
      "Ranger Chocolate invites neighbours to a tasting at Calendly's new cafe.",
    );
  });

  it("drops the page's emphasis marks", () => {
    expect(
      quoteSentence(
        "**The Calendly Pro Plan is going away in December 2026.**",
        names,
      ),
    ).toBe("The Calendly Pro Plan is going away in December 2026.");
  });

  it("is empty for a passage without a sentence", () => {
    expect(quoteSentence("Nov 12 · 5 min", names)).toBeNull();
  });
});
