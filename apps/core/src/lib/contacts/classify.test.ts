import { describe, expect, it } from "vitest";
import {
  type ClassifiedContact,
  checkListProposal,
  classificationChanges,
  isNonPersonName,
  LIST_MEMBERSHIP_THRESHOLD,
  MAX_AUTO_LISTS_PER_DAY,
  pickListMemberships,
  similarListName,
} from "./classify";

describe("isNonPersonName", () => {
  it("flags practices, offices, teams, inboxes and companies", () => {
    for (const name of [
      "Praxis",
      "Praxis Dr. Weber",
      "Kanzlei Brandt",
      "Office",
      "Team Acme",
      "Info",
      "Support",
      "Northwind GmbH",
      "Acme Inc.",
      "Helvetia Holding AG",
    ])
      expect(isNonPersonName(name), name).toBe(true);
  });

  it("keeps people, first names alone and addresses", () => {
    for (const name of [
      "Anna Schmidt",
      "Federico",
      "Liam O'Brien",
      "Agathe Bank",
      "Dr. Anna Weber",
      "info@praxis-weber.de",
    ])
      expect(isNonPersonName(name), name).toBe(false);
  });
});

const captured: ClassifiedContact = {
  name: "Praxis",
  kind: "PERSON",
  stage: "CONTACT",
  createdByPerson: false,
  personEdited: new Set(),
  placeholderName: false,
};

describe("classificationChanges", () => {
  it("turns a practice inbox into a named organization", () => {
    expect(
      classificationChanges(captured, {
        kind: "ORGANIZATION",
        name: "Praxis Weber",
        stage: null,
      }),
    ).toEqual({ kind: "ORGANIZATION", name: "Praxis Weber" });
  });

  it("gives a placeholder a real person's name, never a non-person one", () => {
    const placeholder = {
      ...captured,
      name: "a.weber@praxis-weber.de",
      placeholderName: true,
    };
    expect(
      classificationChanges(placeholder, {
        kind: "PERSON",
        name: "Anna Weber",
      }),
    ).toEqual({ name: "Anna Weber" });
    expect(
      classificationChanges(placeholder, { kind: "PERSON", name: "Praxis" }),
    ).toEqual({});
  });

  it("names an entry that is still just an address", () => {
    expect(
      classificationChanges(
        { ...captured, name: "hello@mintlabs.io" },
        { kind: "ORGANIZATION", name: "Mintlabs" },
      ),
    ).toEqual({ kind: "ORGANIZATION", name: "Mintlabs" });
  });

  it("leaves a real person's name alone", () => {
    expect(
      classificationChanges(
        { ...captured, name: "Federico" },
        { kind: "PERSON", name: "Federico Rossi" },
      ),
    ).toEqual({});
  });

  it("sets a relationship only over the default and only from its own set", () => {
    expect(
      classificationChanges(
        { ...captured, name: "Anna Schmidt" },
        { stage: "INVESTOR" },
      ),
    ).toEqual({ stage: "INVESTOR" });
    expect(
      classificationChanges(
        { ...captured, name: "Anna Schmidt", stage: "LEAD" },
        { stage: "INVESTOR" },
      ),
    ).toEqual({});
    expect(
      classificationChanges(
        { ...captured, name: "Anna Schmidt" },
        { stage: "PROSPECT" },
      ),
    ).toEqual({});
  });

  it("never changes what a person typed or edited", () => {
    expect(
      classificationChanges(
        { ...captured, createdByPerson: true },
        { kind: "ORGANIZATION", name: "Praxis Weber", stage: "VENDOR" },
      ),
    ).toEqual({});
    expect(
      classificationChanges(
        { ...captured, personEdited: new Set(["kind", "name", "stage"]) },
        { kind: "ORGANIZATION", name: "Praxis Weber", stage: "VENDOR" },
      ),
    ).toEqual({});
  });
});

describe("pickListMemberships", () => {
  const lists = [
    { id: "investors", smart: false },
    { id: "agencies", smart: false },
    { id: "zurich", smart: false },
    { id: "stale", smart: true },
  ];

  it("adds only above the threshold, most certain first, at most two", () => {
    expect(
      pickListMemberships(
        new Map([
          ["investors", 0.95],
          ["agencies", LIST_MEMBERSHIP_THRESHOLD - 0.01],
          ["zurich", 0.85],
        ]),
        lists,
        new Set(),
      ),
    ).toEqual(["investors", "zurich"]);
    expect(
      pickListMemberships(
        new Map([
          ["investors", 0.9],
          ["agencies", 0.91],
          ["zurich", 0.99],
        ]),
        lists,
        new Set(),
      ),
    ).toEqual(["zurich", "agencies"]);
  });

  it("never adds to smart lists or lists the contact is already on", () => {
    expect(
      pickListMemberships(
        new Map([
          ["stale", 1],
          ["investors", 0.99],
        ]),
        lists,
        new Set(["investors"]),
      ),
    ).toEqual([]);
  });
});

describe("similarListName", () => {
  it("catches case, number and containment", () => {
    expect(similarListName("investors", ["Investor"])).toBe("Investor");
    expect(similarListName("Angel investors", ["Investors"])).toBe("Investors");
    expect(similarListName("Cardano ecosystem", ["Cardano"])).toBe("Cardano");
    expect(similarListName("Press & media", ["Media and press"])).toBe(
      "Media and press",
    );
  });

  it("lets a different group through", () => {
    expect(similarListName("Agencies", ["Investors", "Zurich community"])).toBe(
      null,
    );
  });
});

describe("checkListProposal", () => {
  const candidateIds = new Set(["a", "b", "c", "d"]);
  const proposal = {
    name: "Agencies",
    description: "Creative agencies we work with.",
    memberIds: ["a", "b", "c"],
  };

  it("accepts three known members, a fresh name and a free cap", () => {
    expect(
      checkListProposal(proposal, {
        existingNames: ["Investors"],
        candidateIds,
        createdToday: 0,
      }),
    ).toEqual({ ok: true, proposal });
  });

  it("rejects too few members, counting only known and distinct ones", () => {
    expect(
      checkListProposal(
        { ...proposal, memberIds: ["a", "a", "b", "x"] },
        { existingNames: [], candidateIds, createdToday: 0 },
      ),
    ).toEqual({ ok: false, reason: "too_few_members" });
  });

  it("rejects a list like one that exists, and the day's second list", () => {
    expect(
      checkListProposal(proposal, {
        existingNames: ["agency"],
        candidateIds,
        createdToday: 0,
      }),
    ).toEqual({ ok: false, reason: "similar_list" });
    expect(
      checkListProposal(proposal, {
        existingNames: [],
        candidateIds,
        createdToday: MAX_AUTO_LISTS_PER_DAY,
      }),
    ).toEqual({ ok: false, reason: "daily_cap" });
  });
});
