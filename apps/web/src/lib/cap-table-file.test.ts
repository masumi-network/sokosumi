import { describe, expect, it } from "vitest";

import {
  capTableRows,
  isCapTableFileName,
  parseCapTable,
} from "./cap-table-file";

const sumico = {
  kind: "sokosumi.cap-table",
  version: 1,
  company: "Sumico, Inc.",
  asOf: "2026-11-06",
  authorizedShares: 10_000_000,
  holders: [
    { name: "Patrick Tobler", shareClass: "Common", shares: 6_500_000 },
    { name: "Sebastian Küpers", shareClass: "Common", shares: 500_000 },
  ],
  pools: [{ name: "2026 Stock Plan", reserved: 2_000_000 }],
};

describe("parseCapTable", () => {
  it("reads a cap table file and refuses anything else", () => {
    expect(parseCapTable(sumico)?.pools[0].granted).toBe(0);
    expect(parseCapTable({ ...sumico, holders: [] })).toBeNull();
    expect(parseCapTable({ ...sumico, kind: "sokosumi.team" })).toBeNull();
    expect(
      parseCapTable({
        ...sumico,
        holders: [{ name: "A", shareClass: "Common", shares: 1.5 }],
      }),
    ).toBeNull();
  });

  it("knows the file by its name", () => {
    expect(isCapTableFileName("Cap table.CAPTABLE.json")).toBe(true);
    expect(isCapTableFileName("Team.team.json")).toBe(false);
  });
});

describe("capTableRows", () => {
  it("splits ownership of issued stock and of the fully diluted count", () => {
    const table = parseCapTable(sumico);
    if (!table) throw new Error("fixture must parse");
    const {
      rows,
      issuedShares,
      reservedShares,
      fullyDilutedShares,
      unallocatedShares,
    } = capTableRows(table);

    expect(issuedShares).toBe(7_000_000);
    expect(reservedShares).toBe(2_000_000);
    expect(fullyDilutedShares).toBe(9_000_000);
    expect(unallocatedShares).toBe(1_000_000);
    expect(
      rows.map((row) => [
        row.name,
        row.issued === null ? null : Number(row.issued.toFixed(4)),
        Number(row.fullyDiluted.toFixed(4)),
      ]),
    ).toEqual([
      ["Patrick Tobler", 0.9286, 0.7222],
      ["Sebastian Küpers", 0.0714, 0.0556],
      ["2026 Stock Plan", null, 0.2222],
    ]);
  });
});
