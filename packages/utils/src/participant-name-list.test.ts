import { describe, expect, it } from "vitest";

import {
  compareByDisplayNameThenId,
  formatParticipantNameList,
} from "./participant-name-list";

describe("formatParticipantNameList", () => {
  it("joins a short list", () => {
    expect(formatParticipantNameList(["Andreas", "Elena"])).toBe(
      "Andreas, Elena",
    );
  });

  it("counts the rest of a long list", () => {
    expect(
      formatParticipantNameList(["Andreas", "Elena", "Hannah", "Alex"]),
    ).toBe("Andreas, Elena, Hannah and 1 more");
  });

  it("keeps two members of the same name", () => {
    expect(formatParticipantNameList(["Sam", "Sam"])).toBe("Sam, Sam");
  });

  it("names nobody as an empty string", () => {
    expect(formatParticipantNameList([])).toBe("");
  });
});

describe("compareByDisplayNameThenId", () => {
  it("orders by the name people are shown under", () => {
    const sorted = [
      { id: "u2", name: "Elena" },
      { id: "u1", name: "Andreas" },
    ].toSorted(compareByDisplayNameThenId);

    expect(sorted.map((person) => person.name)).toEqual(["Andreas", "Elena"]);
  });

  it("breaks a tie on the id, so one order survives two reads", () => {
    const sorted = [
      { id: "u2", name: "Sam" },
      { id: "u1", name: "Sam" },
    ].toSorted(compareByDisplayNameThenId);

    expect(sorted.map((person) => person.id)).toEqual(["u1", "u2"]);
  });
});
