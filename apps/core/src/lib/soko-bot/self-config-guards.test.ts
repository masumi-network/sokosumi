import { describe, expect, it } from "vitest";
import { skillChangeRefusal, sokoBotDriveFolder } from "./self-config-guards";

describe("sokoBotDriveFolder", () => {
  it("normalizes a folder path", () => {
    expect(sokoBotDriveFolder(" /Masumi Fundraising/ ")).toEqual({
      folder: "Masumi Fundraising",
    });
    expect(sokoBotDriveFolder("Marketing//Q4")).toEqual({
      folder: "Marketing/Q4",
    });
    expect(sokoBotDriveFolder(undefined)).toEqual({ folder: "" });
  });

  it("refuses dot segments and the virtual task folder", () => {
    expect(sokoBotDriveFolder("a/../b")).toHaveProperty("refusal");
    expect(sokoBotDriveFolder("Sokosumi Projects/x")).toHaveProperty("refusal");
  });
});

describe("skillChangeRefusal", () => {
  const ownerChat = {
    source: "CHAT",
    chainDepth: 0,
    askedByAssistant: false,
    shared: false,
  };

  it("allows the owner's own chat request", () => {
    expect(skillChangeRefusal(ownerChat)).toBeNull();
  });

  it.each([
    ["an event turn", { source: "EVENT" }],
    ["a scheduled turn", { source: "SCHEDULE" }],
    ["a chained turn", { chainDepth: 1 }],
    ["another assistant asking", { askedByAssistant: true }],
    ["a shared bot", { shared: true }],
  ])("refuses %s", (_, change) => {
    expect(skillChangeRefusal({ ...ownerChat, ...change })).not.toBeNull();
  });
});
