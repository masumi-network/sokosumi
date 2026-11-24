import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";

import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { Prisma, PrismaClient } from "./generated/prisma/client.js";

const models = Object.values(Prisma.ModelName);
const network: Record<string, string> = networkTables.network;
const shared: Record<string, string> = networkTables.shared;

/** Prisma's own model metadata; building the client opens no connection. */
const dataModel = (
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://127.0.0.1:1/none",
    }),
  }) as unknown as {
    _runtimeDataModel: { models: Record<string, { dbName: string | null }> };
  }
)._runtimeDataModel.models;

/**
 * Prisma's implicit many-to-many join tables and the tables they join, from
 * the SQL Prisma writes for this schema (no database needed).
 */
function implicitJoinTables(): Map<string, string[]> {
  const sql = execFileSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma",
      "--script",
    ],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
  );
  const joins = new Map<string, string[]>();
  for (const [, table, target] of sql.matchAll(
    /^ALTER TABLE "(_\w+)" ADD CONSTRAINT .* REFERENCES "(\w+)"/gm,
  )) {
    joins.set(table, [...(joins.get(table) ?? []), target]);
  }
  return joins;
}

describe("prisma/network-tables.json", () => {
  it("places every Prisma model in the shared or the Network list", () => {
    const unplaced = models.filter(
      (model) => !(model in network) && !(model in shared),
    );
    expect(unplaced, "add each new model to one list").toEqual([]);
  });

  it("places no model in both lists", () => {
    expect(Object.keys(network).filter((model) => model in shared)).toEqual([]);
  });

  it("lists only models that exist", () => {
    const known = new Set<string>(models);
    expect(
      [...Object.keys(network), ...Object.keys(shared)].filter(
        (name) => !known.has(name),
      ),
    ).toEqual([]);
  });

  it("gives each model the SQL table Prisma maps it to", () => {
    const wrong = Object.entries({ ...network, ...shared }).filter(
      ([model, table]) => (dataModel[model]?.dbName ?? model) !== table,
    );
    expect(wrong).toEqual([]);
  });

  it("names every SQL object once", () => {
    const names = [
      ...Object.values(network),
      ...networkTables.networkJoinTables,
      ...Object.values(shared),
      ...networkTables.sharedSqlOnly,
    ];
    expect(
      names.filter((name, index) => names.indexOf(name) !== index),
    ).toEqual([]);
  });

  it("lists exactly the join tables between Network models, and none crosses", () => {
    const networkTableNames = new Set(Object.values(network));
    const joins = [...implicitJoinTables()];
    expect(joins.length).toBeGreaterThan(0);
    const crossing = joins.filter(
      ([, targets]) =>
        targets.some((target) => networkTableNames.has(target)) &&
        !targets.every((target) => networkTableNames.has(target)),
    );
    expect(crossing, "an implicit relation crosses Network and shared").toEqual(
      [],
    );
    expect(
      joins
        .filter(([, targets]) => targets.every((t) => networkTableNames.has(t)))
        .map(([table]) => table)
        .sort(),
    ).toEqual([...networkTables.networkJoinTables].sort());
    // Spawns the Prisma CLI: about 1 s, more on a busy machine.
  }, 30_000);
});
