import { describe, expect, it } from "vitest";

import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { Prisma } from "./generated/prisma/client.js";

const models = Object.values(Prisma.ModelName);
const network = Object.keys(networkTables.network);
const shared = networkTables.shared;

describe("prisma/network-tables.json", () => {
  it("places every Prisma model in the shared or the Network list", () => {
    const unplaced = models.filter(
      (model) => !network.includes(model) && !shared.includes(model),
    );
    expect(unplaced, "add each new model to one list").toEqual([]);
  });

  it("places no model in both lists", () => {
    expect(network.filter((model) => shared.includes(model))).toEqual([]);
  });

  it("lists only models that exist", () => {
    const known = new Set<string>(models);
    expect([...network, ...shared].filter((name) => !known.has(name))).toEqual(
      [],
    );
  });
});
