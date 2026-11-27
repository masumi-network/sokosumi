import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NETWORKS,
  type Network,
  networkKey,
  requireNetwork,
  requireNetworkOn,
} from "./network";

/** A fresh module with this environment, so the environment is read again. */
async function freshNetworkModule(env: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return await import("./network");
}

/** The split layout with Preprod on. */
const PREPROD_ON = {
  NETWORK_PREPROD_ENABLED: "true",
  DATABASE_SCHEMA_SHARED: "shared",
  DATABASE_SCHEMA_MAINNET: "mainnet",
  DATABASE_SCHEMA_PREPROD: "preprod",
};

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
    // @ts-expect-error The Network and the name are required.
    expect(() => networkKey()).toThrow("Unknown Network");
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

describe("isPreprodOn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function preprodOn(env: Record<string, string | undefined>) {
    return (await freshNetworkModule(env)).isPreprodOn();
  }

  it("is false by default", async () => {
    expect(await preprodOn({ NETWORK_PREPROD_ENABLED: undefined })).toBe(false);
  });

  it("is true when the flag is on and the three schema names are all different and none `public`", async () => {
    expect(await preprodOn(PREPROD_ON)).toBe(true);
  });
});

describe("networksThatAreOn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns Mainnet while Preprod is off", async () => {
    const network = await freshNetworkModule({
      ...PREPROD_ON,
      NETWORK_PREPROD_ENABLED: "false",
    });
    expect(network.networksThatAreOn()).toEqual(["mainnet"]);
  });

  it("returns Mainnet and Preprod while Preprod is on", async () => {
    const network = await freshNetworkModule(PREPROD_ON);
    expect(network.networksThatAreOn()).toEqual(["mainnet", "preprod"]);
  });
});

describe("requireNetworkOn", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function withPreprodOn() {
    return (await freshNetworkModule(PREPROD_ON)).requireNetworkOn;
  }

  it("returns Mainnet", () => {
    expect(requireNetworkOn("mainnet")).toBe("mainnet");
  });

  it("throws for Preprod while Preprod is off", () => {
    expect(() => requireNetworkOn("preprod")).toThrow("Preprod is off");
  });

  it("returns Preprod while Preprod is on", async () => {
    expect((await withPreprodOn())("preprod")).toBe("preprod");
  });

  it("throws on a value that is not a Network, also while Preprod is on", async () => {
    const whilePreprodIsOn = await withPreprodOn();

    expect(() => requireNetworkOn("Preprod")).toThrow("Unknown Network");
    expect(() => whilePreprodIsOn("Preprod")).toThrow("Unknown Network");
  });
});
