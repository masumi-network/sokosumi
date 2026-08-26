import { describe, expect, it } from "vitest";
import {
  CHANNEL_NAME_MAX,
  CHANNEL_TOPIC_MAX,
  canCreateChannel,
  createChannelSubmitFields,
  createInitialWizard,
  remainingNameChars,
  remainingTopicChars,
  sanitizeChannelNameInput,
  setAddPeopleMode,
  setDiscoverability,
  setName,
  setSlug,
  setSpecificMembers,
  setTopic,
  toAddPeople,
} from "../create-channel-wizard";

describe("create-channel-wizard", () => {
  it("createInitialWizard starts on create with an empty handle and public visibility", () => {
    expect(createInitialWizard()).toEqual({
      step: "create",
      slug: "",
      slugDirty: false,
      name: "",
      nameDirty: false,
      topic: "",
      discoverability: "public",
    });
  });

  it("sanitizeChannelNameInput strips leading hashes and clamps length", () => {
    expect(sanitizeChannelNameInput("##launch")).toBe("launch");
    expect(sanitizeChannelNameInput("#")).toBe("");
    expect(
      sanitizeChannelNameInput(`#${"a".repeat(CHANNEL_NAME_MAX + 5)}`),
    ).toBe("a".repeat(CHANNEL_NAME_MAX));
  });

  it("prefills name from the handle and follows until the name is edited", () => {
    const handled = setSlug(createInitialWizard(), "team-soko");
    expect(handled).toEqual({
      step: "create",
      slug: "team-soko",
      slugDirty: true,
      name: "Team Soko",
      nameDirty: false,
      topic: "",
      discoverability: "public",
    });
    expect(setSlug(handled, "welcome")).toEqual({
      step: "create",
      slug: "welcome",
      slugDirty: true,
      name: "Welcome",
      nameDirty: false,
      topic: "",
      discoverability: "public",
    });
  });

  it("stops following the handle after the name is edited", () => {
    const handled = setSlug(createInitialWizard(), "team-soko");
    const custom = setName(handled, "Launch");
    expect(custom).toEqual({
      step: "create",
      slug: "team-soko",
      slugDirty: true,
      name: "Launch",
      nameDirty: true,
      topic: "",
      discoverability: "public",
    });
    expect(setSlug(custom, "welcome")).toEqual({
      step: "create",
      slug: "welcome",
      slugDirty: true,
      name: "Launch",
      nameDirty: true,
      topic: "",
      discoverability: "public",
    });
  });

  it("canCreateChannel requires a name, a sanitized slug, and free availability", () => {
    const empty = createInitialWizard();
    expect(canCreateChannel(empty, "free")).toBe(false);
    expect(canCreateChannel(setSlug(empty, "welcome"), "free")).toBe(true);
    expect(
      canCreateChannel(setName(setSlug(empty, "welcome"), "   "), "free"),
    ).toBe(false);
    expect(canCreateChannel(setSlug(empty, "welcome"), "taken")).toBe(false);
    expect(canCreateChannel(setSlug(empty, "welcome"), "unknown")).toBe(false);
    expect(canCreateChannel(setSlug(empty, "welcome"), "error")).toBe(false);
    expect(canCreateChannel(setSlug(empty, "---"), "invalid")).toBe(false);
  });

  it("live-sanitizes typed slug keystrokes", () => {
    expect(setSlug(createInitialWizard(), " Team Soko ")).toEqual({
      step: "create",
      slug: "team-soko",
      slugDirty: true,
      name: "Team Soko",
      nameDirty: false,
      topic: "",
      discoverability: "public",
    });
  });

  it("createChannelSubmitFields sends name, slug, optional topic, and visibility", () => {
    const wizard = setDiscoverability(
      setTopic(setSlug(createInitialWizard(), "team-soko"), "Ship it"),
      "private",
    );
    expect(createChannelSubmitFields(wizard)).toEqual({
      name: "Team Soko",
      slug: "team-soko",
      topic: "Ship it",
      discoverability: "private",
    });
    expect(createChannelSubmitFields(createInitialWizard())).toBeNull();
    expect(
      createChannelSubmitFields(
        setName(setSlug(createInitialWizard(), "ok"), ""),
      ),
    ).toBeNull();
  });

  it("omits a blank topic from submit fields", () => {
    expect(
      createChannelSubmitFields(
        setTopic(setSlug(createInitialWizard(), "welcome"), "  "),
      ),
    ).toEqual({
      name: "Welcome",
      slug: "welcome",
      discoverability: "public",
    });
  });

  it("clamps topic length", () => {
    const topic = `a`.repeat(CHANNEL_TOPIC_MAX + 8);
    expect(setTopic(createInitialWizard(), topic)).toMatchObject({
      topic: "a".repeat(CHANNEL_TOPIC_MAX),
    });
  });

  it("setDiscoverability only applies on create", () => {
    const create = setSlug(createInitialWizard(), "launch");
    expect(setDiscoverability(create, "private")).toEqual({
      ...create,
      discoverability: "private",
    });
    expect(setDiscoverability(create, "external")).toEqual({
      ...create,
      discoverability: "external",
    });

    const addPeople = toAddPeople(
      create,
      { id: "room-1", name: "Launch" },
      "user-1",
    );
    expect(setDiscoverability(addPeople, "private")).toBe(addPeople);
  });

  it("toAddPeople transitions after create with all mode and locks the creator on the roster", () => {
    const create = setSlug(createInitialWizard(), "launch");
    expect(
      toAddPeople(create, { id: "room-1", name: "Launch" }, "user-1"),
    ).toEqual({
      step: "add-people",
      roomId: "room-1",
      roomName: "Launch",
      mode: "all",
      memberUserIds: ["user-1"],
      coworkerIds: [],
    });
  });

  it("setAddPeopleMode and setSpecificMembers update add-people only", () => {
    const addPeople = toAddPeople(
      setSlug(createInitialWizard(), "launch"),
      { id: "room-1", name: "Launch" },
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

    const create = createInitialWizard();
    expect(setAddPeopleMode(create, "specific")).toBe(create);
    expect(
      setSpecificMembers(create, { memberUserIds: ["u1"], coworkerIds: [] }),
    ).toBe(create);
  });

  it("remaining counters count against max", () => {
    expect(remainingNameChars("")).toBe(CHANNEL_NAME_MAX);
    expect(remainingNameChars("abc")).toBe(CHANNEL_NAME_MAX - 3);
    expect(remainingTopicChars("")).toBe(CHANNEL_TOPIC_MAX);
    expect(remainingTopicChars("ab")).toBe(CHANNEL_TOPIC_MAX - 2);
  });
});
