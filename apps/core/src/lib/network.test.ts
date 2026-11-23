import { describe, expect, it } from "vitest";

import { NETWORKS, type Network, networkKey, requireNetwork } from "./network";

describe("networkKey", () => {
  it("keeps today's Mainnet key, so locks and cursors written before the move still match", () => {
    expect(networkKey("mainnet", "agents-sync")).toBe("agents-sync");
  });

  it("puts Preprod keys under their own prefix", () => {
    expect(networkKey("preprod", "agents-sync")).toBe("preprod:agents-sync");
  });

  it("gives every Network a different key for the same name", () => {
    const keys = NETWORKS.map((network) => networkKey(network, "cursor"));
    expect(new Set(keys).size).toBe(NETWORKS.length);
  });

  it.each([undefined, "Mainnet", "Preprod", "", "toString", "__proto__"])(
    "throws on a value that is not a Network: %s",
    (value) => {
      expect(() => networkKey(value as Network, "agents-sync")).toThrow(
        "Unknown Network",
      );
    },
  );

  it("requires the Network at compile time", () => {
    // @ts-expect-error The Network is required.
    expect(() => networkKey("agents-sync")).toThrow("Unknown Network");
    // @ts-expect-error A deployment `NETWORK` value is not a Network.
    expect(() => networkKey("Mainnet", "agents-sync")).toThrow();
  });
});

describe("requireNetwork", () => {
  it.each(NETWORKS)("returns %s", (network) => {
    expect(requireNetwork(network)).toBe(network);
  });
});
