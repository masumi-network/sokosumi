import { makeChatTypingChannelName } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  capabilityGrants,
  parseAblyCapabilityMap,
} from "./ably-capability-map";

describe("parseAblyCapabilityMap", () => {
  it("reads a capability that arrived as JSON", () => {
    expect(
      parseAblyCapabilityMap('{"chat_rooms:room_a":["subscribe"]}'),
    ).toEqual({ "chat_rooms:room_a": ["subscribe"] });
  });

  it("reads a capability that arrived already parsed", () => {
    expect(
      parseAblyCapabilityMap({ "chat_rooms:room_a": ["subscribe"] }),
    ).toEqual({ "chat_rooms:room_a": ["subscribe"] });
  });

  it("grants nothing when the capability is missing or unreadable", () => {
    expect(parseAblyCapabilityMap(null)).toBeNull();
    expect(parseAblyCapabilityMap(undefined)).toBeNull();
    expect(parseAblyCapabilityMap("not json")).toBeNull();
    expect(parseAblyCapabilityMap("[1,2]")).toBeNull();
    expect(parseAblyCapabilityMap(["chat_rooms:room_a"])).toBeNull();
    expect(parseAblyCapabilityMap(42)).toBeNull();
  });
});

describe("capabilityGrants", () => {
  const typingChannel = makeChatTypingChannelName("room-a");

  it("sees a granted operation on the exact channel", () => {
    expect(
      capabilityGrants(
        { [typingChannel]: ["publish", "subscribe"] },
        typingChannel,
        "publish",
      ),
    ).toBe(true);
  });

  it("refuses an operation the token does not grant", () => {
    expect(
      capabilityGrants(
        { [typingChannel]: ["subscribe"] },
        typingChannel,
        "publish",
      ),
    ).toBe(false);
  });

  it("refuses a channel the token says nothing about", () => {
    expect(
      capabilityGrants(
        { "chat_rooms:room_a": ["subscribe"] },
        typingChannel,
        "publish",
      ),
    ).toBe(false);
  });

  it("refuses everything when the capability is unreadable", () => {
    expect(capabilityGrants(null, typingChannel, "publish")).toBe(false);
    expect(capabilityGrants("not json", typingChannel, "publish")).toBe(false);
  });
});
