import { describe, expect, it } from "vitest";
import {
  backToCreate,
  CHANNEL_NAME_MAX,
  CHANNEL_SLUG_MAX,
  CHANNEL_TOPIC_MAX,
  canCreateChannel,
  channelSlugFromName,
  createChannelSubmitFields,
  createInitialWizard,
  editLink,
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
} from "./create-channel-wizard";

describe("create-channel-wizard", () => {
  it("createInitialWizard starts on create with an empty name and link and public visibility", () => {
    expect(createInitialWizard()).toEqual({
      step: "create",
      slug: "",
      slugDirty: false,
      name: "",
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

  it("channelSlugFromName makes a link from the name's letters and numbers", () => {
    expect(channelSlugFromName("Launch plans")).toBe("launch-plans");
    expect(channelSlugFromName("  Q1 OKRs!  ")).toBe("q1-okrs");
    expect(channelSlugFromName("Café Zürich")).toBe("cafe-zurich");
    expect(channelSlugFromName("Launch ")).toBe("launch");
    expect(channelSlugFromName("日本語")).toBe("");
    expect(channelSlugFromName("")).toBe("");
  });

  it("channelSlugFromName clamps to the link limit without a trailing hyphen", () => {
    const name = `${"a".repeat(CHANNEL_SLUG_MAX - 1)} b`;
    expect(channelSlugFromName(name)).toBe("a".repeat(CHANNEL_SLUG_MAX - 1));
  });

  it("derives the link from the name until the link is edited", () => {
    const named = setName(createInitialWizard(), "Launch plans");
    expect(named).toEqual({
      step: "create",
      slug: "launch-plans",
      slugDirty: false,
      name: "Launch plans",
      topic: "",
      discoverability: "public",
    });
    expect(setName(named, "Spring launch")).toMatchObject({
      slug: "spring-launch",
      slugDirty: false,
    });
  });

  it("keeps an edited link when the name changes", () => {
    const linked = setSlug(setName(createInitialWizard(), "Launch"), "go");
    expect(linked).toMatchObject({
      slug: "go",
      slugDirty: true,
      name: "Launch",
    });
    expect(setName(linked, "Launch plans")).toMatchObject({
      slug: "go",
      slugDirty: true,
      name: "Launch plans",
    });
  });

  it("editLink stops following the name and keeps the current link", () => {
    const named = setName(createInitialWizard(), "Launch plans");
    expect(editLink(named)).toEqual({ ...named, slugDirty: true });
    expect(setName(editLink(named), "Other")).toMatchObject({
      slug: "launch-plans",
      name: "Other",
    });
    const people = toAddPeople(named, "user-1");
    expect(editLink(people)).toBe(people);
  });

  it("canCreateChannel requires a name, a sanitized slug, and free availability", () => {
    const empty = createInitialWizard();
    const welcome = setName(empty, "Welcome");
    expect(canCreateChannel(empty, "free")).toBe(false);
    expect(canCreateChannel(welcome, "free")).toBe(true);
    expect(canCreateChannel(setName(welcome, "   "), "free")).toBe(false);
    expect(canCreateChannel(welcome, "taken")).toBe(false);
    expect(canCreateChannel(welcome, "unknown")).toBe(false);
    expect(canCreateChannel(welcome, "error")).toBe(false);
    expect(canCreateChannel(setName(empty, "日本語"), "invalid")).toBe(false);
    expect(canCreateChannel(setSlug(welcome, "---"), "invalid")).toBe(false);
  });

  it("live-sanitizes typed link keystrokes and leaves the name alone", () => {
    expect(setSlug(createInitialWizard(), " Team Soko ")).toEqual({
      step: "create",
      slug: "team-soko-",
      slugDirty: true,
      name: "",
      topic: "",
      discoverability: "public",
    });
  });

  it("turns a typed space into a hyphen and keeps a typed hyphen", () => {
    const started = setSlug(createInitialWizard(), "team");
    expect(setSlug(started, "team ")).toMatchObject({ slug: "team-" });
    expect(setSlug(started, "team-")).toMatchObject({ slug: "team-" });
    expect(setSlug(started, "team-soko")).toMatchObject({ slug: "team-soko" });
  });

  it("createChannelSubmitFields sends form fields and roster only on add-people", () => {
    const details = setDiscoverability(
      setTopic(setName(createInitialWizard(), "Team Soko"), "Ship it"),
      "private",
    );
    expect(
      createChannelSubmitFields(details, {
        memberUserIds: ["user-1"],
        coworkerIds: [],
        sokoBotIds: [],
      }),
    ).toBeNull();

    const people = toAddPeople(details, "user-1");
    expect(
      createChannelSubmitFields(people, {
        memberUserIds: ["user-1", "user-2"],
        coworkerIds: ["c1"],
        sokoBotIds: [],
      }),
    ).toEqual({
      name: "Team Soko",
      slug: "team-soko",
      topic: "Ship it",
      discoverability: "private",
      memberUserIds: ["user-1", "user-2"],
      coworkerIds: ["c1"],
      sokoBotIds: [],
    });
  });

  it("omits a blank topic from submit fields", () => {
    expect(
      createChannelSubmitFields(
        toAddPeople(
          setTopic(setName(createInitialWizard(), "Welcome"), "  "),
          "user-1",
        ),
        { memberUserIds: [], coworkerIds: [], sokoBotIds: [] },
      ),
    ).toEqual({
      name: "Welcome",
      slug: "welcome",
      discoverability: "public",
      memberUserIds: [],
      coworkerIds: [],
      sokoBotIds: [],
    });
  });

  it("clamps topic length", () => {
    const topic = `a`.repeat(CHANNEL_TOPIC_MAX + 8);
    expect(setTopic(createInitialWizard(), topic)).toMatchObject({
      topic: "a".repeat(CHANNEL_TOPIC_MAX),
    });
  });

  it("setDiscoverability only applies on create", () => {
    const create = setName(createInitialWizard(), "Launch");
    expect(setDiscoverability(create, "private")).toEqual({
      ...create,
      discoverability: "private",
    });
    expect(setDiscoverability(create, "external")).toEqual({
      ...create,
      discoverability: "external",
    });

    const addPeople = toAddPeople(create, "user-1");
    expect(setDiscoverability(addPeople, "private")).toBe(addPeople);
  });

  it("toAddPeople keeps form fields and does not create a room", () => {
    const create = setName(createInitialWizard(), "Launch");
    expect(toAddPeople(create, "user-1")).toEqual({
      step: "add-people",
      slug: "launch",
      slugDirty: false,
      name: "Launch",
      topic: "",
      discoverability: "public",
      mode: "all",
      memberUserIds: ["user-1"],
      coworkerIds: [],
      sokoBotIds: [],
    });
    expect(toAddPeople(createInitialWizard(), "user-1").step).toBe(
      "add-people",
    );
  });

  it("backToCreate restores the form without dropping link or name", () => {
    const people = toAddPeople(
      setName(createInitialWizard(), "Launch"),
      "user-1",
    );
    expect(backToCreate(people)).toEqual({
      step: "create",
      slug: "launch",
      slugDirty: false,
      name: "Launch",
      topic: "",
      discoverability: "public",
    });
    expect(backToCreate(createInitialWizard())).toEqual(createInitialWizard());
  });

  it("setAddPeopleMode and setSpecificMembers update add-people only", () => {
    const addPeople = toAddPeople(
      setName(createInitialWizard(), "Launch"),
      "user-1",
    );
    const specific = setAddPeopleMode(addPeople, "specific");
    expect(specific).toMatchObject({ step: "add-people", mode: "specific" });
    expect(
      setSpecificMembers(specific, {
        memberUserIds: ["u1"],
        coworkerIds: ["c1"],
        sokoBotIds: [],
      }),
    ).toMatchObject({
      memberUserIds: ["u1"],
      coworkerIds: ["c1"],
    });

    const create = createInitialWizard();
    expect(setAddPeopleMode(create, "specific")).toBe(create);
    expect(
      setSpecificMembers(create, {
        memberUserIds: ["u1"],
        coworkerIds: [],
        sokoBotIds: [],
      }),
    ).toBe(create);
  });

  it("remaining counters count against max", () => {
    expect(remainingNameChars("")).toBe(CHANNEL_NAME_MAX);
    expect(remainingNameChars("abc")).toBe(CHANNEL_NAME_MAX - 3);
    expect(remainingTopicChars("")).toBe(CHANNEL_TOPIC_MAX);
    expect(remainingTopicChars("ab")).toBe(CHANNEL_TOPIC_MAX - 2);
  });
});
