import { describe, expect, it } from "vitest";
import { contactExportTable } from "./export-table";

describe("contactExportTable", () => {
  it("writes one row per contact, a column per field", () => {
    const table = contactExportTable(
      [
        {
          name: "Lena Fox",
          organization: null,
          role: "Writer",
          location: "Berlin",
          stage: "COMMUNITY",
          lastContactAt: "2026-11-01T10:00:00.000Z",
          channels: [
            { type: "EMAIL", value: "lena@fox.io", followers: null },
            { type: "X", value: "lenafox", followers: 12000 },
          ],
          lists: [{ name: "X followers" }, { name: "Berlin" }],
        } as never,
      ],
      "export-1",
    );
    const byName = Object.fromEntries(
      table.columns.map((column) => [column.name, column.id]),
    );
    const values = table.rows[0]?.values ?? {};
    expect(values[byName.Name ?? ""]).toBe("Lena Fox");
    expect(values[byName.Email ?? ""]).toBe("lena@fox.io");
    expect(values[byName.X ?? ""]).toBe("@lenafox");
    expect(values[byName["X followers"] ?? ""]).toBe(12000);
    expect(values[byName["Last contact"] ?? ""]).toBe("2026-11-01");
    expect(values[byName.Lists ?? ""]).toBe("X followers, Berlin");
    expect(values[byName.Phone ?? ""]).toBeNull();
  });

  it("gives every export its own column ids, the same on a retry", () => {
    const ids = (seed: string) =>
      contactExportTable([], seed).columns.map((column) => column.id);
    expect(ids("export-1")).toEqual(ids("export-1"));
    expect(ids("export-1")).not.toEqual(ids("export-2"));
    expect(new Set(ids("export-1")).size).toBe(12);
  });
});
