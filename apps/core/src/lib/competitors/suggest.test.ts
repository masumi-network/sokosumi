import { describe, expect, it } from "vitest";

import type { AskCompetitorModel } from "./model";
import {
  MAX_SUGGESTIONS,
  mergeSuggestions,
  pickCompetitors,
  type SuggestionCandidate,
  suggestionCandidates,
} from "./suggest";

function result(name: string, url: string, description = `${name} sells`) {
  return { title: name, url, passages: [], company: { name, description } };
}

function candidate(n: number): SuggestionCandidate {
  return {
    name: `Company ${n}`,
    websiteUrl: `https://company${n}.example/`,
    about: `About ${n}`,
  };
}

function model(output: unknown) {
  const calls: string[] = [];
  const ask: AskCompetitorModel = async ({ prompt, schema }) => {
    calls.push(prompt);
    return { output: schema.parse(output), costUsd: 0.003 };
  };
  return { ask, calls };
}

describe("suggestionCandidates", () => {
  it("keeps one company per site, at its homepage", () => {
    expect(
      suggestionCandidates(
        [
          result("Calendly", "https://www.calendly.com/pricing"),
          result("Calendly Teams", "https://calendly.com/teams"),
        ],
        { hosts: [], names: [] },
      ),
    ).toEqual([
      {
        name: "Calendly",
        websiteUrl: "https://www.calendly.com/",
        about: "Calendly sells",
      },
    ]);
  });

  it("leaves out the business, tracked competitors and profile sites", () => {
    expect(
      suggestionCandidates(
        [
          result("Cal.com", "https://cal.com/"),
          result("Zcal", "https://zcal.co/"),
          result("Cal com", "https://calcom.example/"),
          result("SavvyCal", "https://www.linkedin.com/company/savvycal"),
          result("Doodle", "https://www.crunchbase.com/organization/doodle"),
          result("No description", "https://nodescription.example/", ""),
        ],
        { hosts: ["www.cal.com", "zcal.co"], names: ["Cal.com"] },
      ),
    ).toEqual([]);
  });
});

describe("pickCompetitors", () => {
  it("keeps the competitors in the model's order, with the search's own address", async () => {
    const { ask, calls } = model({
      items: [
        { n: 1, competitor: true, name: "Company One", why: " Sells   one. " },
        { n: 0, competitor: false, name: "Company 0", why: "A customer." },
        { n: 7, competitor: true, name: "Nobody", why: "Not on the list." },
      ],
      known: [],
    });
    const { suggestions, costUsd } = await pickCompetitors(
      { name: "Cal.com", about: "Scheduling" },
      [candidate(0), candidate(1)],
      ask,
    );
    expect(costUsd).toBe(0.003);
    expect(suggestions).toEqual([
      {
        name: "Company One",
        websiteUrl: "https://company1.example/",
        why: "Sells one.",
      },
    ]);
    expect(JSON.parse(calls[0] ?? "{}").companies[1]).toEqual({
      n: 1,
      name: "Company 1",
      description: "About 1",
    });
  });

  it("returns the well-known competitors apart, as homepages to verify", async () => {
    const { ask } = model({
      items: [],
      known: [
        {
          name: "Calendly",
          domain: "https://calendly.com/pricing",
          why: "Scheduling links.",
        },
        { name: "Nowhere", domain: "not a domain", why: "Nothing." },
      ],
    });
    const { suggestions, known } = await pickCompetitors(
      { name: "Cal.com", about: "Scheduling" },
      [],
      ask,
    );
    expect(suggestions).toEqual([]);
    expect(known).toEqual([
      {
        name: "Calendly",
        websiteUrl: "https://calendly.com/",
        why: "Scheduling links.",
      },
    ]);
  });
});

describe("mergeSuggestions", () => {
  const suggestion = (name: string, host: string) => ({
    name,
    websiteUrl: `https://${host}/`,
    why: `${name} sells`,
  });

  it("puts the well-known first and names each company once", () => {
    expect(
      mergeSuggestions(
        [suggestion("Calendly", "calendly.com"), suggestion("Zcal", "zcal.co")],
        [
          suggestion("Calendly Inc", "www.calendly.com"),
          suggestion("Doodle", "doodle.com"),
        ],
        { hosts: ["zcal.co"], names: [] },
      ).map(({ name }) => name),
    ).toEqual(["Calendly", "Doodle"]);
  });

  it("suggests at most eight", () => {
    const found = Array.from({ length: 12 }, (_, n) =>
      suggestion(`Company ${n}`, `company${n}.example`),
    );
    expect(mergeSuggestions([], found, { hosts: [], names: [] })).toHaveLength(
      MAX_SUGGESTIONS,
    );
  });
});
