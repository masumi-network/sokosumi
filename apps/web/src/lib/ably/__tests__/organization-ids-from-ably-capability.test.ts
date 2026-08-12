import { describe, expect, it } from "vitest";

import { organizationIdsFromAblyCapability } from "../organization-ids-from-ably-capability";

describe("organizationIdsFromAblyCapability", () => {
  it("extracts org ids from presence channels", () => {
    const ids = organizationIdsFromAblyCapability({
      "presence:org_org_a": ["presence", "subscribe"],
      "presence:org_org_b": ["presence", "subscribe"],
      "chat_rooms:room_x": ["subscribe"],
    });
    expect(ids).toEqual(["org_a", "org_b"]);
  });

  it("parses string capability JSON", () => {
    const ids = organizationIdsFromAblyCapability(
      JSON.stringify({
        "presence:org_org_1": ["presence"],
      }),
    );
    expect(ids).toEqual(["org_1"]);
  });

  it("returns null for unparseable capability", () => {
    expect(organizationIdsFromAblyCapability(null)).toBeNull();
    expect(organizationIdsFromAblyCapability("not-json")).toBeNull();
  });
});
