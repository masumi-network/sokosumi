import { afterEach, describe, expect, it } from "vitest";

import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { Prisma } from "./generated/prisma/client.js";
import {
  configureSqlTables,
  createSqlTables,
  netTable,
  PUBLIC_LAYOUT,
  type SqlTableLayout,
  sharedTable,
} from "./sql-tables.js";

const SPLIT: SqlTableLayout = {
  shared: "shared",
  mainnet: "mainnet",
  preprod: "preprod",
  preprodOn: true,
};

describe("createSqlTables", () => {
  it("names the schema on today's layout too", () => {
    const tables = createSqlTables(PUBLIC_LAYOUT);
    expect(tables.sharedTable("user").sql).toBe('"public"."user"');
    expect(tables.netTable("mainnet", "Job").sql).toBe('"public"."Job"');
  });

  it("names each side's schema on the split layout", () => {
    const tables = createSqlTables(SPLIT);
    expect(tables.sharedTable("user").sql).toBe('"shared"."user"');
    expect(tables.netTable("mainnet", "jobEvent").sql).toBe(
      '"mainnet"."jobEvent"',
    );
    expect(tables.netTable("preprod", "jobEvent").sql).toBe(
      '"preprod"."jobEvent"',
    );
    expect(tables.netTable("mainnet", "_AgentTag").sql).toBe(
      '"mainnet"."_AgentTag"',
    );
  });

  it("goes into a statement as text, not as a parameter", () => {
    const tables = createSqlTables(SPLIT);
    const statement = Prisma.sql`SELECT id FROM ${tables.netTable("mainnet", "Job")} j JOIN ${tables.sharedTable("workspace")} w ON w.id = j."workspaceId" WHERE j.id = ${"job-1"}`;
    expect(statement.text).toBe(
      'SELECT id FROM "mainnet"."Job" j JOIN "shared"."workspace" w ON w.id = j."workspaceId" WHERE j.id = $1',
    );
    expect(statement.values).toEqual(["job-1"]);
  });

  it("refuses a table of the other side", () => {
    const tables = createSqlTables(SPLIT);
    expect(() => tables.sharedTable("Job")).toThrow(
      "Job is a Network table: use netTable",
    );
    expect(() => tables.netTable("mainnet", "user")).toThrow(
      "user is a shared table: use sharedTable",
    );
  });

  it("refuses a name that is not a listed SQL table", () => {
    const tables = createSqlTables(SPLIT);
    expect(() => tables.sharedTable("nope")).toThrow("Unknown table: nope");
    expect(() => tables.netTable("mainnet", "nope")).toThrow(
      "Unknown table: nope",
    );
    // The Prisma model name is not the SQL name.
    expect(() => tables.netTable("mainnet", "JobEvent")).toThrow(
      "Unknown table: JobEvent",
    );
    expect(() => tables.sharedTable('user" --')).toThrow("Unknown table");
  });

  it("refuses a Network other than mainnet and preprod", () => {
    const tables = createSqlTables(SPLIT);
    for (const network of ["shared", "public", "Mainnet", "", undefined]) {
      expect(() => tables.netTable(network as "mainnet", "Job")).toThrow(
        "Unknown Network",
      );
    }
  });

  it("refuses Preprod while Preprod is off", () => {
    const tables = createSqlTables({ ...SPLIT, preprodOn: false });
    expect(() => tables.netTable("preprod", "Job")).toThrow("Preprod is off");
    expect(tables.netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
  });

  it("refuses Preprod while its schema is Mainnet's, even switched on", () => {
    for (const layout of [
      { ...PUBLIC_LAYOUT, preprodOn: true },
      { ...SPLIT, preprod: "mainnet" },
    ]) {
      expect(() => createSqlTables(layout).netTable("preprod", "Job")).toThrow(
        "Preprod's schema is Mainnet's",
      );
    }
  });

  it("refuses a schema name that is not a plain identifier", () => {
    for (const name of ['pub"lic', "a.b", "", "public; DROP", "1st"]) {
      expect(() => createSqlTables({ ...SPLIT, shared: name })).toThrow(
        "Not a plain SQL identifier",
      );
      expect(() => createSqlTables({ ...SPLIT, preprod: name })).toThrow(
        "Not a plain SQL identifier",
      );
    }
  });

  it("accepts every listed table", () => {
    const tables = createSqlTables(SPLIT);
    for (const table of Object.values(networkTables.shared)) {
      expect(tables.sharedTable(table).sql).toBe(`"shared"."${table}"`);
    }
    for (const table of [
      ...Object.values(networkTables.network),
      ...networkTables.networkJoinTables,
    ]) {
      expect(tables.netTable("preprod", table).sql).toBe(
        `"preprod"."${table}"`,
      );
    }
  });
});

describe("the configured tables", () => {
  afterEach(() => configureSqlTables(PUBLIC_LAYOUT));

  it("is today's layout until configured: public, Preprod off", () => {
    expect(sharedTable("user").sql).toBe('"public"."user"');
    expect(netTable("mainnet", "Job").sql).toBe('"public"."Job"');
    expect(() => netTable("preprod", "Job")).toThrow("Preprod is off");
  });

  it("follows configureSqlTables", () => {
    configureSqlTables(SPLIT);
    expect(sharedTable("user").sql).toBe('"shared"."user"');
    expect(netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
    expect(netTable("preprod", "Job").sql).toBe('"preprod"."Job"');
  });

  it("keeps the old layout when the new one is refused", () => {
    configureSqlTables(SPLIT);
    expect(() => configureSqlTables({ ...SPLIT, mainnet: 'x"' })).toThrow();
    expect(netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
  });
});
