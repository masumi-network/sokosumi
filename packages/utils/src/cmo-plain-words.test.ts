import { describe, expect, it } from "vitest";

import { cmoJargonIn, cmoPlainWordsLine } from "./cmo-plain-words";

const terms = (text: string) => cmoJargonIn(text).map(({ term }) => term);

describe("cmoJargonIn", () => {
  it("finds what NMKR's owner could not follow", () => {
    expect(
      terms("More qualified teams starting their first Studio project"),
    ).toEqual(["qualified"]);
    expect(terms("Launch content impressions")).toEqual(["impressions"]);
    expect(terms("Leads work out which steps they can hand off.")).toEqual([
      "leads",
    ]);
    expect(terms("Free-account offer for leads with a pilot brief")).toEqual([
      "leads",
    ]);
    expect(terms("Watch the CTR and engagement rate")).toEqual([
      "engagement",
      "CTR",
    ]);
  });

  it("leaves plain words and job titles alone", () => {
    expect(terms("Project leads open a free NMKR Studio account")).toEqual([]);
    expect(terms("More intro calls from operations leads")).toEqual([]);
    expect(terms("This leads to more orders")).toEqual([]);
    expect(terms("People who opened a Studio account")).toEqual([]);
  });

  it("lists every word with its plain version for Cuso's rules", () => {
    expect(cmoPlainWordsLine()).toContain(
      '"cadence" → how often; "ICP" → your best buyer',
    );
  });
});
