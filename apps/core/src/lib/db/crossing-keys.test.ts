import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import tables from "../../../../../packages/database/prisma/network-tables.json" with {
  type: "json",
};
import {
  NETWORK_TO_SHARED_KEYS,
  SHARED_TO_NETWORK_KEYS,
} from "./crossing-keys";

interface Field {
  name: string;
  dbName?: string | null;
  type: string;
  isRequired: boolean;
  relationFromFields?: string[];
  relationToFields?: string[];
  relationOnDelete?: string;
  relationOnUpdate?: string;
}

interface Model {
  name: string;
  dbName: string | null;
  fields: Field[];
}

function readPrismaModels(): Model[] {
  const database = fileURLToPath(
    new URL("../../../../../packages/database", import.meta.url),
  );
  const schema = join(database, "prisma");
  const scratch = mkdtempSync(join(tmpdir(), "crossing-keys-"));
  const output = join(scratch, "datamodel.json");
  try {
    for (const name of globSync("**/*.prisma", {
      cwd: schema,
      exclude: ["migrations/**"],
    })) {
      const destination = join(scratch, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(schema, name), destination);
    }
    writeFileSync(
      join(scratch, "crossing-keys.prisma"),
      `generator crossingKeys {
  provider = "node ../../apps/core/scripts/fixtures/write-prisma-datamodel.mts"
  output = ${JSON.stringify(output)}
}
`,
    );
    execFileSync(
      "pnpm",
      [
        "exec",
        "prisma",
        "generate",
        "--schema",
        scratch,
        "--generator",
        "crossingKeys",
        "--no-hints",
      ],
      { cwd: database, stdio: "pipe" },
    );
    return JSON.parse(readFileSync(output, "utf8"));
  } finally {
    rmSync(scratch, { recursive: true });
  }
}

function sqlColumn(model: Model, name: string): Field {
  const field = model.fields.find((field) => field.name === name);
  if (!field) throw new Error(`No Prisma field ${model.name}.${name}`);
  return field;
}

it("inventories every foreign key that crosses between shared and a Network", () => {
  const models = readPrismaModels();
  const modelsByName = new Map(models.map((model) => [model.name, model]));
  const networkToShared: unknown[] = [];
  const sharedToNetwork: unknown[] = [];
  for (const child of models) {
    const childIsNetwork = Object.hasOwn(tables.network, child.name);
    for (const field of child.fields) {
      const childColumns = field.relationFromFields;
      const parent = modelsByName.get(field.type);
      if (!childColumns?.length || !parent) continue;
      if (childIsNetwork === Object.hasOwn(tables.network, parent.name))
        continue;

      const key = `${child.name}.${field.name}`;
      expect(childColumns, key).toHaveLength(1);
      const column = sqlColumn(child, childColumns[0]);
      expect(
        field.relationToFields?.map((name) => {
          const target = sqlColumn(parent, name);
          return target.dbName ?? target.name;
        }),
        key,
      ).toEqual(["id"]);
      const row = [
        child.dbName ?? child.name,
        column.dbName ?? column.name,
        parent.dbName ?? parent.name,
        // PostgreSQL defaults for Prisma relations with no explicit action.
        field.relationOnDelete ?? (field.isRequired ? "Restrict" : "SetNull"),
        field.relationOnUpdate ?? "Cascade",
        !column.isRequired,
      ];
      if (childIsNetwork) {
        networkToShared.push(row);
      } else {
        sharedToNetwork.push([
          ...row,
          child.fields.some(
            (field) => (field.dbName ?? field.name) === "network",
          )
            ? "tagged"
            : "mainnet",
        ]);
      }
    }
  }

  expect(networkToShared.sort()).toEqual(
    NETWORK_TO_SHARED_KEYS.map(
      ([child, column, parent, onDelete, onUpdate, nullable]) => [
        child,
        column,
        parent,
        onDelete,
        onUpdate,
        nullable,
      ],
    ).sort(),
  );
  expect(sharedToNetwork.sort()).toEqual(
    SHARED_TO_NETWORK_KEYS.map(
      ([child, column, parent, onDelete, onUpdate, nullable, , routing]) => [
        child,
        column,
        parent,
        onDelete,
        onUpdate,
        nullable,
        routing,
      ],
    ).sort(),
  );
}, 30_000);
