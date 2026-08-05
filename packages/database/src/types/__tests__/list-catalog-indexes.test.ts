import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentOrderBy } from "../agent.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = join(packageRoot, "prisma/schema.prisma");
const migrationsDir = join(packageRoot, "prisma/migrations");

function readSchema(): string {
  return readFileSync(schemaPath, "utf8");
}

function modelBlock(schema: string, modelName: string): string {
  const match = schema.match(
    new RegExp(`model ${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  expect(match, `model ${modelName} in schema.prisma`).toBeTruthy();
  return match?.[1] ?? "";
}

function migrationSqlFiles(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsDir, entry.name, "migration.sql"))
    .map((path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    });
}

describe("list and catalog performance indexes", () => {
  it("agentOrderBy is createdAt-only without jobs._count", () => {
    expect(agentOrderBy).toEqual([{ createdAt: "desc" }]);
    expect(JSON.stringify(agentOrderBy)).not.toContain("_count");
  });

  it("schema.prisma declares TaskEvent, Job, and Agent list/catalog indexes", () => {
    const schema = readSchema();

    expect(modelBlock(schema, "TaskEvent")).toContain(
      "@@index([taskId, createdAt])",
    );
    expect(modelBlock(schema, "Job")).toContain(
      "@@index([workspaceId, createdAt(sort: Desc)])",
    );
    expect(modelBlock(schema, "Agent")).toContain("@@index([isShown, status])");
  });

  it("migrations create matching Postgres indexes", () => {
    const sql = migrationSqlFiles().join("\n");

    expect(sql).toMatch(/"taskEvent_taskId_createdAt_idx"/);
    expect(sql).toMatch(/"Job_workspaceId_createdAt_idx"/);
    expect(sql).toMatch(/"Agent_isShown_status_idx"/);
    expect(sql).toMatch(
      /CREATE INDEX "Job_workspaceId_createdAt_idx" ON "Job"\("workspaceId", "createdAt" DESC\)/,
    );
  });
});
