import { describe, expect, it, onTestFinished } from "vitest";

import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { PrismaRaw } from "./client.js";
import { $Enums } from "./index.js";
import {
  configureSqlTables,
  createSqlTables,
  netTable,
  netType,
  PUBLIC_LAYOUT,
  type SqlTableLayout,
  sharedTable,
  sharedType,
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
    expect(tables.sharedType("TaskStatus").sql).toBe('"public"."TaskStatus"');
    expect(tables.netType("mainnet", "JobType").sql).toBe('"public"."JobType"');
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
    expect(tables.sharedType("FileLabelKind").sql).toBe(
      '"shared"."FileLabelKind"',
    );
    expect(tables.netType("mainnet", "AgentStatus").sql).toBe(
      '"mainnet"."AgentStatus"',
    );
    expect(tables.netType("preprod", "AgentStatus").sql).toBe(
      '"preprod"."AgentStatus"',
    );
  });

  it("goes into a statement as text, not as a parameter", () => {
    const tables = createSqlTables(SPLIT);
    const statement = PrismaRaw.sql`SELECT id FROM ${tables.netTable("mainnet", "Job")} j JOIN ${tables.sharedTable("workspace")} w ON w.id = j."workspaceId" WHERE j."jobType" = ${"PAID"}::${tables.netType("mainnet", "JobType")}`;
    expect(statement.text).toBe(
      'SELECT id FROM "mainnet"."Job" j JOIN "shared"."workspace" w ON w.id = j."workspaceId" WHERE j."jobType" = $1::"mainnet"."JobType"',
    );
    expect(statement.values).toEqual(["PAID"]);
  });

  it("refuses a table or type of the other side", () => {
    const tables = createSqlTables(SPLIT);
    expect(() => tables.sharedTable("Job")).toThrow(
      "Job is a Network table: use netTable",
    );
    expect(() => tables.netTable("mainnet", "user")).toThrow(
      "user is a shared table: use sharedTable",
    );
    expect(() => tables.sharedType("AgentStatus")).toThrow(
      "AgentStatus is a Network type: use netType",
    );
    expect(() => tables.netType("mainnet", "TaskStatus")).toThrow(
      "TaskStatus is a shared type: use sharedType",
    );
  });

  it("refuses a name that is not a listed SQL table or enum", () => {
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
    expect(() => tables.sharedType("Nope")).toThrow("Unknown type: Nope");
    expect(() => tables.netType("mainnet", "Nope")).toThrow(
      "Unknown type: Nope",
    );
    // A table is not a type, and the reverse.
    expect(() => tables.sharedType("user")).toThrow("Unknown type: user");
    expect(() => tables.sharedTable("TaskStatus")).toThrow("Unknown table");
  });

  it("refuses a Network other than mainnet and preprod", () => {
    const tables = createSqlTables(SPLIT);
    for (const network of ["shared", "public", "Mainnet", "", undefined]) {
      expect(() => tables.netTable(network as "mainnet", "Job")).toThrow(
        "Unknown Network",
      );
      expect(() => tables.netType(network as "mainnet", "JobType")).toThrow(
        "Unknown Network",
      );
    }
  });

  it("refuses Preprod while Preprod is off", () => {
    const tables = createSqlTables({ ...SPLIT, preprodOn: false });
    expect(() => tables.netTable("preprod", "Job")).toThrow("Preprod is off");
    expect(() => tables.netType("preprod", "JobType")).toThrow(
      "Preprod is off",
    );
    expect(tables.netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
  });

  it("refuses a layout that mixes the Networks' schemas", () => {
    for (const layout of [
      { ...SPLIT, preprod: "mainnet" },
      { ...SPLIT, preprod: "public" },
      { ...SPLIT, mainnet: "public" },
      { ...SPLIT, shared: "public" },
      { ...SPLIT, preprod: "shared" },
      { ...PUBLIC_LAYOUT, shared: "shared" },
      { ...SPLIT, preprodOn: false, preprod: "mainnet" },
    ]) {
      expect(() => createSqlTables(layout), JSON.stringify(layout)).toThrow(
        "must be all public, or all different and none public",
      );
    }
  });

  it("refuses Preprod on today's layout", () => {
    expect(() =>
      createSqlTables({ ...PUBLIC_LAYOUT, preprodOn: true }),
    ).toThrow("Preprod can be on only while");
  });

  it("refuses a Preprod switch that is not a boolean", () => {
    const notBooleans: unknown[] = ["true", "false", 1, undefined, null];
    for (const preprodOn of notBooleans) {
      expect(() =>
        createSqlTables({ ...SPLIT, preprodOn: preprodOn as boolean }),
      ).toThrow("preprodOn must be true or false");
    }
  });

  it("refuses two names PostgreSQL would cut to one schema", () => {
    const long = "n".repeat(63);
    expect(() =>
      createSqlTables({ ...SPLIT, mainnet: `${long}a`, preprod: `${long}b` }),
    ).toThrow("Not a plain SQL identifier");
    expect(
      createSqlTables({ ...SPLIT, mainnet: long }).netTable("mainnet", "Job")
        .sql,
    ).toBe(`"${long}"."Job"`);
  });

  it("refuses a schema name that is not a lowercase plain identifier", () => {
    for (const name of [
      'pub"lic',
      "a.b",
      "",
      "public; DROP",
      "1st",
      undefined,
      null,
      42,
    ]) {
      for (const side of ["shared", "mainnet", "preprod"]) {
        expect(
          () => createSqlTables({ ...SPLIT, [side]: name }),
          `${side}: ${String(name)}`,
        ).toThrow("Not a plain SQL identifier");
      }
    }
    for (const name of [
      "Mainnet",
      "pg_catalog",
      "pg_temp",
      "information_schema",
    ]) {
      expect(() => createSqlTables({ ...SPLIT, mainnet: name }), name).toThrow(
        "Not a schema name for tables",
      );
    }
    expect(() =>
      createSqlTables({ ...PUBLIC_LAYOUT, shared: "pg_temp" }),
    ).toThrow("Not a schema name for tables");
  });

  it("quotes the names it checked, whatever a second read returns", () => {
    let reads = 0;
    const layout: SqlTableLayout = {
      ...SPLIT,
      get preprod() {
        reads += 1;
        return reads === 1 ? "preprod" : "public";
      },
    };
    expect(createSqlTables(layout).netTable("preprod", "Tag").sql).toBe(
      '"preprod"."Tag"',
    );
    expect(reads).toBe(1);
  });

  it("accepts every listed table and enum", () => {
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
    for (const type of networkTables.networkEnums) {
      expect(tables.netType("preprod", type).sql).toBe(`"preprod"."${type}"`);
    }
    const sharedTypes = Object.keys($Enums).filter(
      (type) => !networkTables.networkEnums.includes(type),
    );
    for (const type of sharedTypes) {
      expect(tables.sharedType(type).sql).toBe(`"shared"."${type}"`);
    }
  });
});

describe("the configured tables", () => {
  it("is today's layout until configured: public, Preprod off", () => {
    expect(sharedTable("user").sql).toBe('"public"."user"');
    expect(netTable("mainnet", "Job").sql).toBe('"public"."Job"');
    expect(sharedType("TaskStatus").sql).toBe('"public"."TaskStatus"');
    expect(netType("mainnet", "JobType").sql).toBe('"public"."JobType"');
    expect(() => netTable("preprod", "Job")).toThrow("Preprod is off");
  });

  it("follows configureSqlTables", () => {
    onTestFinished(configureSqlTables(SPLIT));
    expect(sharedTable("user").sql).toBe('"shared"."user"');
    expect(netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
    expect(netTable("preprod", "Job").sql).toBe('"preprod"."Job"');
    expect(sharedType("TaskStatus").sql).toBe('"shared"."TaskStatus"');
    expect(netType("preprod", "JobType").sql).toBe('"preprod"."JobType"');
  });

  it("gives back a function that restores the layout configured before", () => {
    const restoreSplit = configureSqlTables(SPLIT);
    const restoreOther = configureSqlTables({ ...SPLIT, shared: "other" });
    expect(sharedTable("user").sql).toBe('"other"."user"');
    restoreOther();
    expect(sharedTable("user").sql).toBe('"shared"."user"');
    restoreSplit();
    expect(sharedTable("user").sql).toBe('"public"."user"');
  });

  it("keeps the old layout when the new one is refused", () => {
    onTestFinished(configureSqlTables(SPLIT));
    expect(() => configureSqlTables({ ...SPLIT, mainnet: 'x"' })).toThrow();
    expect(netTable("mainnet", "Job").sql).toBe('"mainnet"."Job"');
  });
});
