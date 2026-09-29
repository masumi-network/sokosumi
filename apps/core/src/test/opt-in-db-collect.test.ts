import { describe, expect, it } from "vitest";

import { cliSelectsOptInDbFile, optInDbExclude } from "../../vitest.config";

const node = "/usr/bin/node";
const vitestBin = "/repo/apps/core/node_modules/vitest/vitest.mjs";

describe("opt-in db vitest collect", () => {
  it("leaves opt-in files out of a default run and keeps the admin router test", () => {
    expect(cliSelectsOptInDbFile([node, vitestBin, "run"])).toBe(false);
    expect(optInDbExclude).toContain("src/**/*.postgres.test.ts");
    expect(optInDbExclude.join("\n")).not.toContain(
      "admin.integration.test.ts",
    );
  });

  it("collects the postgres paths the CI step passes", () => {
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "src/routes/v1/projects/get.postgres.test.ts",
        "src/helpers/project-activity.postgres.test.ts",
        "src/helpers/calendar-erasure.postgres.test.ts",
      ]),
    ).toBe(true);
  });

  it("collects a file stem or a line filter, not a directory or the admin file", () => {
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "seat-assignment-concurrency",
      ]),
    ).toBe(true);
    expect(
      cliSelectsOptInDbFile([node, vitestBin, "run", "calendar-erasure"]),
    ).toBe(true);
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "src/helpers/calendar-erasure.postgres.test.ts:40",
      ]),
    ).toBe(true);
    expect(cliSelectsOptInDbFile([node, vitestBin, "run", "src/helpers"])).toBe(
      false,
    );
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "src/routes/v1/admin/admin.integration.test.ts",
      ]),
    ).toBe(false);
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "src/routes/v1/admin/admin.integration.test.ts:25",
      ]),
    ).toBe(false);
    expect(
      cliSelectsOptInDbFile([
        node,
        vitestBin,
        "run",
        "src/routes/v1/projects/get.test.ts",
      ]),
    ).toBe(false);
  });
});
