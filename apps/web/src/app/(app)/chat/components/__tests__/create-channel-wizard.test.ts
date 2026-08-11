import { describe, expect, it } from "vitest";
import {
  advanceNameToVisibility,
  backToName,
  CHANNEL_NAME_MAX,
  canAdvanceFromName,
  createInitialWizard,
  remainingNameChars,
  sanitizeChannelNameInput,
  setAddPeopleMode,
  setDiscoverability,
  setSpecificMembers,
  toAddPeople,
} from "../create-channel-wizard";

describe("create-channel-wizard", () => {
  it("createInitialWizard starts on name with empty string", () => {
    expect(createInitialWizard()).toEqual({ step: "name", name: "" });
  });

  it("sanitizeChannelNameInput strips leading hashes and clamps length", () => {
    expect(sanitizeChannelNameInput("##launch")).toBe("launch");
    expect(sanitizeChannelNameInput("#")).toBe("");
    expect(
      sanitizeChannelNameInput(`#${"a".repeat(CHANNEL_NAME_MAX + 5)}`),
    ).toBe("a".repeat(CHANNEL_NAME_MAX));
  });

  it("canAdvanceFromName requires trimmed length 1..80", () => {
    expect(canAdvanceFromName({ step: "name", name: "" })).toBe(false);
    expect(canAdvanceFromName({ step: "name", name: "   " })).toBe(false);
    expect(canAdvanceFromName({ step: "name", name: "ok" })).toBe(true);
    expect(
      canAdvanceFromName({ step: "name", name: "a".repeat(CHANNEL_NAME_MAX) }),
    ).toBe(true);
    expect(
      canAdvanceFromName({
        step: "visibility",
        name: "ok",
        discoverability: "public",
      }),
    ).toBe(false);
  });

  it("advanceNameToVisibility trims name and defaults to public", () => {
    expect(
      advanceNameToVisibility({ step: "name", name: "  launch  " }),
    ).toEqual({
      step: "visibility",
      name: "launch",
      discoverability: "public",
    });
    expect(advanceNameToVisibility({ step: "name", name: "  " })).toBeNull();
  });

  it("setDiscoverability and backToName only apply on visibility", () => {
    const visibility = {
      step: "visibility" as const,
      name: "launch",
      discoverability: "public" as const,
    };
    expect(setDiscoverability(visibility, "private")).toEqual({
      ...visibility,
      discoverability: "private",
    });
    expect(setDiscoverability(visibility, "external")).toEqual({
      ...visibility,
      discoverability: "external",
    });
    expect(backToName(visibility)).toEqual({ step: "name", name: "launch" });

    const nameStep = createInitialWizard();
    expect(setDiscoverability(nameStep, "private")).toBe(nameStep);
    expect(setDiscoverability(nameStep, "external")).toBe(nameStep);
    expect(backToName(nameStep)).toBe(nameStep);
  });

  it("supports external discoverability through create flow", () => {
    const visibility = {
      step: "visibility" as const,
      name: "partners",
      discoverability: "external" as const,
    };
    expect(visibility.discoverability).toBe("external");
    expect(
      toAddPeople(visibility, { id: "room-ext", name: "partners" }),
    ).toMatchObject({
      step: "add-people",
      roomId: "room-ext",
      roomName: "partners",
    });
  });

  it("toAddPeople transitions after create with all mode", () => {
    const visibility = {
      step: "visibility" as const,
      name: "launch",
      discoverability: "public" as const,
    };
    expect(toAddPeople(visibility, { id: "room-1", name: "launch" })).toEqual({
      step: "add-people",
      roomId: "room-1",
      roomName: "launch",
      mode: "all",
      memberUserIds: [],
      coworkerIds: [],
    });
  });

  it("setAddPeopleMode and setSpecificMembers update add-people only", () => {
    const addPeople = toAddPeople(
      {
        step: "visibility",
        name: "launch",
        discoverability: "public",
      },
      { id: "room-1", name: "launch" },
    );
    const specific = setAddPeopleMode(addPeople, "specific");
    expect(specific).toMatchObject({ step: "add-people", mode: "specific" });
    expect(
      setSpecificMembers(specific, {
        memberUserIds: ["u1"],
        coworkerIds: ["c1"],
      }),
    ).toMatchObject({
      memberUserIds: ["u1"],
      coworkerIds: ["c1"],
    });

    const nameStep = createInitialWizard();
    expect(setAddPeopleMode(nameStep, "specific")).toBe(nameStep);
    expect(
      setSpecificMembers(nameStep, { memberUserIds: ["u1"], coworkerIds: [] }),
    ).toBe(nameStep);
  });

  it("remainingNameChars counts against max", () => {
    expect(remainingNameChars("")).toBe(CHANNEL_NAME_MAX);
    expect(remainingNameChars("abc")).toBe(CHANNEL_NAME_MAX - 3);
  });
});
