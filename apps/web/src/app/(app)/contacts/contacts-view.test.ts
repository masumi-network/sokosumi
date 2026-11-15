import { describe, expect, it } from "vitest";
import {
  CONTACT_PRESET_IDS,
  CONTACT_STAGES,
  type ContactView,
  channelHref,
  channelLabel,
  contactQuery,
  coreErrorOf,
  daysSince,
  defaultDirection,
  guessImportMapping,
  initials,
  isFollowUpDue,
  matchesContactSearch,
  primaryEmail,
  STAGE_DOT,
  searchMatchRange,
  smartFilterOf,
  sortChannels,
} from "./contacts-view";

const base: ContactView = {
  view: "all",
  company: null,
  search: "",
  stage: null,
  replyState: null,
  kind: null,
  knownBy: null,
  source: null,
  sort: "updatedAt",
  direction: "desc",
};

describe("contactQuery", () => {
  it("narrows to one company inside any view", () => {
    expect(
      contactQuery({
        ...base,
        view: "mine",
        company: "Cardano Foundation",
      }),
    ).toMatchObject({ knownByMe: "true", company: "Cardano Foundation" });
    expect(contactQuery(base)).not.toHaveProperty("company");
  });

  it("maps each preset tab to the documented query params", () => {
    expect(CONTACT_PRESET_IDS).toEqual(["all", "mine", "recent"]);
    expect(contactQuery({ ...base, view: "mine" })).toMatchObject({
      knownByMe: "true",
    });
    expect(contactQuery({ ...base, view: "recent" })).toMatchObject({
      createdWithinDays: 14,
    });
    expect(contactQuery(base)).toEqual({
      sort: "updatedAt",
      direction: "desc",
    });
  });

  it("treats any other view as a list id", () => {
    const listId = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e8f";
    expect(contactQuery({ ...base, view: listId }).listId).toBe(listId);
    expect(contactQuery({ ...base, view: "stale" })).not.toHaveProperty(
      "listId",
    );
  });

  it("narrows the view with the toolbar filters", () => {
    expect(
      contactQuery({
        ...base,
        search: "  ada ",
        stage: "LEAD",
        knownBy: "user-2",
      }),
    ).toMatchObject({
      search: "ada",
      stage: "LEAD",
      knownByUserId: "user-2",
    });
    expect(contactQuery({ ...base, knownBy: "me" })).toMatchObject({
      knownByMe: "true",
    });
    expect(
      contactQuery({
        ...base,
        replyState: "AWAITING_REPLY",
        kind: "ORGANIZATION",
      }),
    ).toMatchObject({ replyState: "AWAITING_REPLY", kind: "ORGANIZATION" });
  });
});

describe("classification", () => {
  it("offers every stage once, the plain default first", () => {
    expect(CONTACT_STAGES[0]).toBe("CONTACT");
    expect(new Set(CONTACT_STAGES).size).toBe(CONTACT_STAGES.length);
    expect(Object.keys(STAGE_DOT).sort()).toEqual([...CONTACT_STAGES].sort());
  });
});

describe("email and reply", () => {
  const channel = (value: string, isPrimary: boolean, type = "EMAIL") => ({
    id: value,
    type: type as "EMAIL",
    value,
    label: null,
    isPrimary,
    source: "EMAIL" as const,
    sourceUrl: null,
    verified: false,
    followers: null,
    createdAt: new Date(),
  });

  it("shows the primary email, else the first one, else nothing", () => {
    expect(
      primaryEmail([channel("b@x.co", false), channel("a@x.co", true)]),
    ).toBe("a@x.co");
    expect(primaryEmail([channel("b@x.co", false)])).toBe("b@x.co");
    expect(primaryEmail([channel("+41790000000", true, "PHONE")])).toBeNull();
  });

  it("counts whole days waited, never below zero", () => {
    const now = new Date("2026-10-23T12:00:00Z");
    expect(daysSince("2026-10-11T13:00:00Z", now)).toBe(11);
    expect(daysSince("2026-10-24T00:00:00Z", now)).toBe(0);
  });
});

describe("channels", () => {
  it("opens each channel where a person would", () => {
    expect(channelHref({ type: "EMAIL", value: "a@b.co" })).toBe(
      "mailto:a@b.co",
    );
    expect(channelHref({ type: "PHONE", value: "+491511234" })).toBe(
      "tel:+491511234",
    );
    expect(channelHref({ type: "WHATSAPP", value: "+49 151" })).toBe(
      "https://wa.me/49151",
    );
    expect(channelHref({ type: "X", value: "ada" })).toBe("https://x.com/ada");
    expect(channelHref({ type: "SLACK", value: "T1:U1" })).toBeNull();
    expect(
      channelHref({ type: "WEBSITE", value: "javascript:alert(1)" }),
    ).toBeNull();
  });

  it("reads handles and URLs without their scheme", () => {
    expect(channelLabel({ type: "X", value: "ada" })).toBe("@ada");
    expect(
      channelLabel({
        type: "LINKEDIN",
        value: "https://www.linkedin.com/in/ada",
      }),
    ).toBe("in/ada");
    expect(channelLabel({ type: "WEBSITE", value: "https://ada.dev" })).toBe(
      "ada.dev",
    );
  });

  it("lists the most direct channels first, primary before the rest", () => {
    const channel = (type: string, isPrimary = false) =>
      ({ type, isPrimary }) as Parameters<typeof sortChannels>[0][number];
    expect(
      sortChannels([
        channel("WEBSITE"),
        channel("EMAIL"),
        channel("EMAIL", true),
        channel("LINKEDIN"),
      ]).map((item) => `${item.type}${item.isPrimary ? "*" : ""}`),
    ).toEqual(["EMAIL*", "EMAIL", "LINKEDIN", "WEBSITE"]);
  });
});

describe("helpers", () => {
  it("takes initials from the first and last word", () => {
    expect(initials("Ada Lovelace King")).toBe("AK");
    expect(initials("ada")).toBe("A");
    expect(initials("  ")).toBe("?");
  });

  it("sorts text ascending and dates newest first by default", () => {
    expect(defaultDirection("name")).toBe("asc");
    expect(defaultDirection("lastContactAt")).toBe("desc");
  });

  it("counts a follow-up as due on its day and before", () => {
    const today = new Date(2026, 9, 22, 12);
    expect(isFollowUpDue("2026-10-22", today)).toBe(true);
    expect(isFollowUpDue("2026-10-21", today)).toBe(true);
    expect(isFollowUpDue("2026-10-23", today)).toBe(false);
    expect(isFollowUpDue(null, today)).toBe(false);
  });

  it("reads Core's error kind and the contact a taken channel belongs to", () => {
    expect(
      coreErrorOf({
        error: "Conflict",
        kind: "contact_channel_taken",
        existingContactId: "c-1",
        message: "taken",
      }),
    ).toEqual({
      kind: "contact_channel_taken",
      existingContactId: "c-1",
      message: "taken",
    });
    expect(coreErrorOf(new Error("boom"))).toEqual({
      kind: undefined,
      message: "boom",
      existingContactId: undefined,
    });
    expect(coreErrorOf(null)).toEqual({});
  });

  it("guesses an import mapping from column names, each column once", () => {
    expect(
      guessImportMapping([
        { id: "1", name: "Name" },
        { id: "2", name: "Company" },
        { id: "3", name: "E-mail" },
        { id: "4", name: "Tags" },
        { id: "5", name: "Relationship" },
        { id: "6", name: "Favourite colour" },
      ]),
    ).toEqual({
      name: "1",
      organization: "2",
      email: "3",
      lists: "4",
      summary: "5",
    });
  });
});

describe("matchesContactSearch", () => {
  const ada = {
    name: "Ada Lovelace",
    organization: "Analytical Engines",
    location: "Zürich, Switzerland",
    channels: [{ value: "ada@engines.test" }],
  } as Parameters<typeof matchesContactSearch>[0];

  it("matches name, organization or a channel, whatever the case", () => {
    expect(matchesContactSearch(ada, "LOVE")).toBe(true);
    expect(matchesContactSearch(ada, " engines ")).toBe(true);
    expect(matchesContactSearch(ada, "ada@")).toBe(true);
    expect(matchesContactSearch(ada, "babbage")).toBe(false);
  });

  it("matches the location without accents", () => {
    expect(matchesContactSearch(ada, "zurich")).toBe(true);
    expect(matchesContactSearch(ada, "ZÜRICH")).toBe(true);
    expect(
      matchesContactSearch({ ...ada, location: "Ærøskøbing" }, "aeroskobing"),
    ).toBe(true);
    expect(matchesContactSearch({ ...ada, location: null }, "zurich")).toBe(
      false,
    );
  });
});

describe("searchMatchRange", () => {
  it("finds the match in the original text, accents and case aside", () => {
    expect(searchMatchRange("Zürich, Switzerland", "zurich")).toEqual([0, 6]);
    expect(searchMatchRange("Zürich, Switzerland", " switz")).toEqual([8, 13]);
    expect(searchMatchRange("Zurich", "ZÜRICH")).toEqual([0, 6]);
    expect(searchMatchRange("Basel", "zurich")).toBeNull();
    expect(searchMatchRange("Basel", "  ")).toBeNull();
  });

  it("folds like PostgreSQL unaccent: expansions and letters NFD keeps", () => {
    // Æ becomes "ae" and ø "o": NFD splits neither.
    expect(searchMatchRange("Ærøskøbing", "aeroskobing")).toEqual([0, 10]);
    expect(searchMatchRange("Straße 5, Berlin", "strasse")).toEqual([0, 6]);
    expect(searchMatchRange("Œuvre", "oeuv")).toEqual([0, 3]);
    expect(searchMatchRange("Łódź", "lodz")).toEqual([0, 4]);
    // Half of an expansion still marks the whole letter.
    expect(searchMatchRange("Ærø", "e")).toEqual([0, 1]);
    expect(searchMatchRange("Gießen", "ss")).toEqual([3, 4]);
  });

  it("keeps combining accents and joined characters inside the mark", () => {
    // Decomposed letters: the accent after the last matched letter is kept.
    expect(searchMatchRange("Cafe\u0301 Paris", "cafe")).toEqual([0, 5]);
    expect(searchMatchRange("Zu\u0308rich", "zu")).toEqual([0, 3]);
    expect(searchMatchRange("Zu\u0308rich", "zurich")).toEqual([0, 7]);
    // A flag is one character made of two code points.
    expect(searchMatchRange("Bern 🇨🇭", "bern 🇨")).toEqual([0, 9]);
  });
});

describe("source filter", () => {
  it("asks Core for contacts with a channel found there", () => {
    expect(contactQuery({ ...base, source: "X" }).channelSource).toBe("X");
  });
});

describe("smartFilterOf", () => {
  it("keeps the preset, the open list and the company as shown", () => {
    expect(
      smartFilterOf({
        ...base,
        view: "recent",
        stage: "LEAD",
        company: "Acme",
      }),
    ).toEqual({ createdWithinDays: 14, stages: ["LEAD"], company: "Acme" });
    const listId = "01a1b9dc-58b8-72c8-8cd2-10fb69d48fc4";
    expect(
      smartFilterOf({ ...base, view: listId, kind: "PERSON" }, "manual"),
    ).toEqual({ listIds: [listId], kind: "PERSON" });
    expect(smartFilterOf({ ...base, view: listId }, "manual")).toBeNull();
    expect(
      smartFilterOf({ ...base, view: listId, kind: "PERSON" }, "smart"),
    ).toBeNull();
  });
});
