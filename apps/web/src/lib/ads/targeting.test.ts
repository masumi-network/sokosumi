import { describe, expect, it } from "vitest";

import { hasTarget, toGoogleTarget, toGoogleTargeting } from "./targeting";

const GERMANY = {
  id: "2276",
  name: "Germany",
  canonicalName: "Germany",
  targetType: "Country",
  countryCode: "DE",
};
const PARIS = {
  id: "1026339",
  name: "Paris",
  canonicalName: "Paris,Texas,United States",
  targetType: "City",
  countryCode: "US",
};
const ENGLISH = { id: "1000", code: "en", name: "English" };
const GERMAN = { id: "1001", code: "de", name: "German" };
const PROFILE = { locationId: "2276", languageCode: "de" } as const;

describe("toGoogleTarget", () => {
  it("keeps the id and name, and spells the full name for reading", () => {
    expect(toGoogleTarget(PARIS)).toEqual({
      id: "1026339",
      name: "Paris",
      detail: "Paris, Texas, United States",
    });
  });
});

describe("hasTarget", () => {
  it("finds a target by id", () => {
    const selected = [{ id: "1", name: "One" }];

    expect(hasTarget(selected, "1")).toBe(true);
    expect(hasTarget(selected, "2")).toBe(false);
  });
});

describe("toGoogleTargeting", () => {
  it("offers every language and starts from the profile's place and language", () => {
    expect(
      toGoogleTargeting({
        profile: PROFILE,
        languages: [ENGLISH, GERMAN],
        locations: [GERMANY],
      }),
    ).toEqual({
      languageOptions: [
        { id: "1000", name: "English" },
        { id: "1001", name: "German" },
      ],
      defaultLocations: [{ id: "2276", name: "Germany", detail: "Germany" }],
      defaultLanguages: [{ id: "1001", name: "German" }],
    });
  });

  it("suggests nothing without a profile", () => {
    expect(
      toGoogleTargeting({ profile: null, languages: [ENGLISH], locations: [] }),
    ).toEqual({
      languageOptions: [{ id: "1000", name: "English" }],
      defaultLocations: [],
      defaultLanguages: [],
    });
  });

  it("matches the profile's language by its exact code", () => {
    const portugueseBrazil = { id: "1014", code: "pt-BR", name: "Brazilian" };

    expect(
      toGoogleTargeting({
        profile: { ...PROFILE, languageCode: "pt" },
        languages: [portugueseBrazil],
        locations: [],
      }).defaultLanguages,
    ).toEqual([]);
    expect(
      toGoogleTargeting({
        profile: { ...PROFILE, languageCode: "ja" },
        languages: [ENGLISH],
        locations: [],
      }).defaultLanguages,
    ).toEqual([]);
  });

  it("has no language options or default when the languages did not load", () => {
    expect(
      toGoogleTargeting({ profile: PROFILE, languages: null, locations: [] }),
    ).toEqual({
      languageOptions: null,
      defaultLocations: [],
      defaultLanguages: [],
    });
  });
});
