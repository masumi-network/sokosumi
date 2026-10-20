import type { RealtimeChannelEnvironment } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationIdsFromAblyCapability } from "./organization-ids-from-ably-capability";

const { channelEnvironment } = vi.hoisted(() => ({
  channelEnvironment: vi.fn<() => RealtimeChannelEnvironment>(),
}));

vi.mock("./realtime-channel-environment", () => ({
  getRealtimeChannelEnvironment: channelEnvironment,
}));

beforeEach(() => {
  channelEnvironment.mockReturnValue({
    network: "Mainnet",
    vercelEnv: "production",
  });
});

describe("organizationIdsFromAblyCapability", () => {
  it("reads only this preview's orgs from a preview token", () => {
    channelEnvironment.mockReturnValue({
      network: "Mainnet",
      vercelEnv: "preview",
      vercelGitCommitRef: "fix/x",
    });

    expect(
      organizationIdsFromAblyCapability({
        "presence:preview:mainnet:branch_fix%2Fx:org_o1": ["presence"],
        "presence:org_o2": ["presence"],
      }),
    ).toEqual(["o1"]);
  });

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
