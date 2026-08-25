import { describe, expect, it } from "vitest";
import {
  advanceNameToVisibility,
  backToName,
  CHANNEL_NAME_MAX,
  canAdvanceFromName,
  createChannelSubmitFields,
  createInitialWizard,
  remainingNameChars,
  sanitizeChannelNameInput,
  setAddPeopleMode,
  setDiscoverability,
  setName,
  setSlug,
  setSpecificMembers,
  toAddPeople,
} from "../create-channel-wizard";

describe("create-channel-wizard", () => {
  it("createInitialWizard starts on name with empty slug following the name", () => {
    expect(createInitialWizard()).toEqual({
      step: "name",
      name: "",
      slug: "",
      slugDirty: false,
    });
  });

  it("sanitizeChannelNameInput strips leading hashes and clamps length", () => {
    expect(sanitizeChannelNameInput("##launch")).toBe("launch");
    expect(sanitizeChannelNameInput("#")).toBe("");
    expect(
      sanitizeChannelNameInput(`#${"a".repeat(CHANNEL_NAME_MAX + 5)}`),
    ).toBe("a".repeat(CHANNEL_NAME_MAX));
  });

  it("canAdvanceFromName requires a name, a sanitized slug, and free availability", () => {
    expect(
      canAdvanceFromName(
        { step: "name", name: "", slug: "", slugDirty: false },
        "free",
      ),
    ).toBe(false);
    expect(
      canAdvanceFromName(
        { step: "name", name: "   ", slug: "", slugDirty: false },
        "free",
      ),
    ).toBe(false);
    expect(
      canAdvanceFromName(
        { step: "name", name: "ok", slug: "ok", slugDirty: false },
        "free",
      ),
    ).toBe(true);
    expect(
      canAdvanceFromName(
        { step: "name", name: "ok", slug: "ok", slugDirty: false },
        "taken",
      ),
    ).toBe(false);
    expect(
      canAdvanceFromName(
        { step: "name", name: "ok", slug: "ok", slugDirty: false },
        "unknown",
      ),
    ).toBe(false);
    expect(
      canAdvanceFromName(
        { step: "name", name: "ok", slug: "", slugDirty: true },
        "invalid",
      ),
    ).toBe(false);
    expect(
      canAdvanceFromName(
        {
          step: "name",
          name: "a".repeat(CHANNEL_NAME_MAX),
          slug: "a".repeat(CHANNEL_NAME_MAX),
          slugDirty: false,
        },
        "free",
      ),
    ).toBe(true);
    expect(
      canAdvanceFromName(
        {
          step: "visibility",
          name: "ok",
          slug: "ok",
          slugDirty: false,
          discoverability: "public",
        },
        "free",
      ),
    ).toBe(false);
  });

  it("prefills slug from the name and follows until the slug is edited", () => {
    const named = setName(createInitialWizard(), "Team Soko");
    expect(named).toEqual({
      step: "name",
      name: "Team Soko",
      slug: "team-soko",
      slugDirty: false,
    });
    expect(setName(named, "Engineering")).toEqual({
      step: "name",
      name: "Engineering",
      slug: "engineering",
      slugDirty: false,
    });
  });

  it("stops following the name after the slug is edited", () => {
    const named = setName(createInitialWizard(), "Team Soko");
    const custom = setSlug(named, "soko");
    expect(custom).toEqual({
      step: "name",
      name: "Team Soko",
      slug: "soko",
      slugDirty: true,
    });
    expect(setName(custom, "Engineering")).toEqual({
      step: "name",
      name: "Engineering",
      slug: "soko",
      slugDirty: true,
    });
  });

  it("live-sanitizes typed slug keystrokes", () => {
    const named = setName(createInitialWizard(), "Engineering");
    expect(setSlug(named, " Team Soko ")).toEqual({
      step: "name",
      name: "Engineering",
      slug: "team-soko",
      slugDirty: true,
    });
  });

  it("cannot continue when the slug is empty after sanitize", () => {
    const wizard = setSlug(setName(createInitialWizard(), "Team Soko"), "---");
    expect(wizard).toMatchObject({ step: "name", slug: "" });
    expect(canAdvanceFromName(wizard, "invalid")).toBe(false);
    expect(advanceNameToVisibility(wizard, "invalid")).toBeNull();
  });

  it("advanceNameToVisibility trims name, keeps slug, and defaults to public", () => {
    expect(
      advanceNameToVisibility(
        { step: "name", name: "  launch  ", slug: "launch", slugDirty: false },
        "free",
      ),
    ).toEqual({
      step: "visibility",
      name: "launch",
      slug: "launch",
      slugDirty: false,
      discoverability: "public",
    });
    expect(
      advanceNameToVisibility(
        { step: "name", name: "  ", slug: "", slugDirty: false },
        "free",
      ),
    ).toBeNull();
  });

  it("createChannelSubmitFields sends the visible slug", () => {
    expect(
      createChannelSubmitFields({
        step: "visibility",
        name: "Team Soko",
        slug: "soko",
        slugDirty: true,
        discoverability: "private",
      }),
    ).toEqual({
      name: "Team Soko",
      slug: "soko",
      discoverability: "private",
    });
    expect(
      createChannelSubmitFields({
        step: "name",
        name: "Team Soko",
        slug: "soko",
        slugDirty: true,
      }),
    ).toBeNull();
  });

  it("setDiscoverability and backToName only apply on visibility", () => {
    const visibility = {
      step: "visibility" as const,
      name: "launch",
      slug: "launch",
      slugDirty: false,
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
    expect(backToName(visibility)).toEqual({
      step: "name",
      name: "launch",
      slug: "launch",
      slugDirty: false,
    });

    const nameStep = createInitialWizard();
    expect(setDiscoverability(nameStep, "private")).toBe(nameStep);
    expect(setDiscoverability(nameStep, "external")).toBe(nameStep);
    expect(backToName(nameStep)).toBe(nameStep);
  });

  it("supports external discoverability through create flow", () => {
    const visibility = {
      step: "visibility" as const,
      name: "partners",
      slug: "partners",
      slugDirty: false,
      discoverability: "external" as const,
    };
    expect(visibility.discoverability).toBe("external");
    expect(
      toAddPeople(visibility, { id: "room-ext", name: "partners" }, "user-1"),
    ).toMatchObject({
      step: "add-people",
      roomId: "room-ext",
      roomName: "partners",
    });
  });

  it("toAddPeople transitions after create with all mode and locks the creator on the roster", () => {
    const visibility = {
      step: "visibility" as const,
      name: "launch",
      slug: "launch",
      slugDirty: false,
      discoverability: "public" as const,
    };
    expect(
      toAddPeople(visibility, { id: "room-1", name: "launch" }, "user-1"),
    ).toEqual({
      step: "add-people",
      roomId: "room-1",
      roomName: "launch",
      mode: "all",
      memberUserIds: ["user-1"],
      coworkerIds: [],
    });
  });

  it("setAddPeopleMode and setSpecificMembers update add-people only", () => {
    const addPeople = toAddPeople(
      {
        step: "visibility",
        name: "launch",
        slug: "launch",
        slugDirty: false,
        discoverability: "public",
      },
      { id: "room-1", name: "launch" },
      "user-1",
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
