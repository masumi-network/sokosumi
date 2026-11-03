import { describe, expect, it } from "vitest";
import {
  parseIdentity,
  parseMatches,
  profileKey,
} from "./contact-suggestions.service";

describe("profileKey", () => {
  it("treats one profile written differently as one person", () => {
    expect(profileKey("https://www.LinkedIn.com/in/MaraLind/?trk=x")).toBe(
      "linkedin.com/in/maralind",
    );
    expect(profileKey("http://linkedin.com/in/maralind")).toBe(
      "linkedin.com/in/maralind",
    );
    expect(profileKey("not a url")).toBeNull();
  });
});

describe("parseMatches", () => {
  it("keeps only the people who fit, around a code fence", () => {
    const text = `\`\`\`json
{"people": [
  {"i": 0, "fits": true, "name": "Mara Lind", "role": "Partner", "organization": "Northwind", "location": "", "reason": "Leads pre-seed AI rounds."},
  {"i": 1, "fits": false, "name": "Someone", "reason": "Not an investor."}
]}
\`\`\``;
    expect(parseMatches(text)).toEqual([
      {
        index: 0,
        name: "Mara Lind",
        role: "Partner",
        organization: "Northwind",
        location: null,
        reason: "Leads pre-seed AI rounds.",
      },
    ]);
  });

  it("finds nobody when the answer does not parse", () => {
    expect(parseMatches("sorry")).toEqual([]);
    expect(parseMatches('{"people": [{"i": "x"}]}')).toEqual([]);
  });
});

describe("parseIdentity", () => {
  it("reads the result that is the person", () => {
    expect(
      parseIdentity(
        '{"i": 2, "role": "GP", "organization": "Fjord", "location": "", "summary": "Invests in seed SaaS."}',
      ),
    ).toEqual({
      index: 2,
      role: "GP",
      organization: "Fjord",
      location: null,
      summary: "Invests in seed SaaS.",
    });
  });

  it("finds nobody when none is them or the answer does not parse", () => {
    expect(parseIdentity('{"i": null}')).toBeNull();
    expect(parseIdentity("no idea")).toBeNull();
  });
});
