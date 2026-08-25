import { describe, expect, it } from "vitest";

import {
  channelLinkInsertText,
  linkifyChannelLinksInMarkdown,
} from "../linkify-channel-links.js";

const general = {
  name: "general",
  slug: "general",
  href: "/chat/rooms/room-general",
};

const launchRoom = {
  name: "Launch Room",
  slug: "launch-room",
  href: "/chat/rooms/room-launch",
};

const launch = {
  name: "Launch",
  slug: "launch",
  href: "/chat/rooms/room-launch-short",
};

describe("linkifyChannelLinksInMarkdown", () => {
  it("turns a glued #name into a markdown link", () => {
    expect(
      linkifyChannelLinksInMarkdown("see #general please", [general]),
    ).toBe("see [#general](/chat/rooms/room-general) please");
  });

  it("matches slug when the display name was not typed", () => {
    expect(
      linkifyChannelLinksInMarkdown("join #launch-room", [launchRoom]),
    ).toBe("join [#launch-room](/chat/rooms/room-launch)");
  });

  it("consumes the longest unique name including spaces", () => {
    expect(
      linkifyChannelLinksInMarkdown("see #Launch Room later", [
        launch,
        launchRoom,
      ]),
    ).toBe("see [#Launch Room](/chat/rooms/room-launch) later");
  });

  it("keeps a shorter name when the longer name is not a prefix of the rest", () => {
    expect(
      linkifyChannelLinksInMarkdown("see #Launch later", [launch, launchRoom]),
    ).toBe("see [#Launch](/chat/rooms/room-launch-short) later");
  });

  it("is case-insensitive and keeps the typed casing in the label", () => {
    expect(linkifyChannelLinksInMarkdown("Go #GENERAL", [general])).toBe(
      "Go [#GENERAL](/chat/rooms/room-general)",
    );
  });

  it("leaves unmatched #text plain", () => {
    expect(linkifyChannelLinksInMarkdown("see #missing", [general])).toBe(
      "see #missing",
    );
  });

  it("does not link markdown headings (space after #)", () => {
    const input = "# general";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not link a run of hashes", () => {
    const input = "##general";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not link # in the middle of a token", () => {
    const input = "issue#general";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not link a prefix of a longer token", () => {
    const input = "see #generally";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not link when two channels share the longest match", () => {
    const otherGeneral = {
      name: "general",
      slug: "general-2",
      href: "/chat/rooms/room-other",
    };
    expect(
      linkifyChannelLinksInMarkdown("see #general", [general, otherGeneral]),
    ).toBe("see #general");
    expect(
      linkifyChannelLinksInMarkdown("see #general-2", [general, otherGeneral]),
    ).toBe("see [#general-2](/chat/rooms/room-other)");
  });

  it("does not rewrite existing markdown links", () => {
    const input = "already [#general](https://example.com) here";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not rewrite inside inline code", () => {
    const input = "use `#general` please";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("does not rewrite inside fenced code", () => {
    const input = "```\n#general\n```";
    expect(linkifyChannelLinksInMarkdown(input, [general])).toBe(input);
  });

  it("links after a newline", () => {
    expect(linkifyChannelLinksInMarkdown("hi\n#general", [general])).toBe(
      "hi\n[#general](/chat/rooms/room-general)",
    );
  });
});

describe("channelLinkInsertText", () => {
  it("inserts #name when that name is unique", () => {
    expect(channelLinkInsertText(launchRoom, [launchRoom, general])).toBe(
      "#Launch Room",
    );
  });

  it("inserts #slug when the display name is not unique", () => {
    const other = {
      name: "general",
      slug: "general-2",
      href: "/chat/rooms/other",
    };
    expect(channelLinkInsertText(other, [general, other])).toBe("#general-2");
  });
});
