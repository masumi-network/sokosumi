import { describe, expect, it } from "vitest";

import { NETWORKS, networkKey } from "./network";

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
});
