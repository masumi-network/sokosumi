import { describe, expect, it } from "vitest";
import { evalWebFetch, evalWebSearch } from "./eval-web-world";
import { INVESTOR_FIXTURE, investorLine } from "./ownerbench/journeys";

describe("evalWebFetch", () => {
  it("finds a page however its address is written", () => {
    for (const url of [
      "https://www.sokosumi.com",
      "https://sokosumi.com/",
      "http://www.sokosumi.com//",
    ])
      expect(evalWebFetch({ url })).toMatchObject({
        url: "https://www.sokosumi.com",
        status: 200,
      });
    expect(evalWebFetch({ url: "https://youtu.be/omM89sE7Jpg" })).toMatchObject(
      { status: 200, text: expect.stringContaining("Routing forms") },
    );
    expect(
      evalWebFetch({ url: "https://m.youtube.com/watch?v=omM89sE7Jpg&t=12" }),
    ).toMatchObject({ status: 200 });
  });

  it("gives each investor's source page the facts the owner's notes have", () => {
    const fund = INVESTOR_FIXTURE.fits[2]!;
    const page = evalWebFetch({ url: fund.source });
    expect(page.status).toBe(200);
    expect(page.text).toContain(investorLine(fund).replaceAll("**", ""));
  });

  it("answers an address it lacks with a 404, the same every time", () => {
    const missing = { url: "https://news.example/today" };
    expect(evalWebFetch(missing)).toEqual({
      url: "https://news.example/today",
      status: 404,
      contentType: "text/plain",
      text: "Not found: this page does not exist.",
    });
    expect(evalWebFetch({ url: "not a url" }).status).toBe(404);
  });

  it("clips to maxChars", () => {
    expect(
      evalWebFetch({ url: "https://cal.com/pricing", maxChars: 10 }).text,
    ).toHaveLength(10);
  });
});

describe("evalWebSearch", () => {
  it("ranks by shared words, then by address, so a query always finds the same", () => {
    const first = evalWebSearch("Cal.com pricing for teams", 3);
    expect(first[0]?.url).toBe("https://cal.com/pricing");
    expect(evalWebSearch("Cal.com pricing for teams", 3)).toEqual(first);
    expect(first[0]?.passages.length).toBeGreaterThan(0);
  });

  it("finds nothing for a query that matches no page", () => {
    expect(evalWebSearch("quantum zebra tariffs", 5)).toEqual([]);
  });
});
