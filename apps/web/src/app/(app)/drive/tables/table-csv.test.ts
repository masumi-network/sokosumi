import { afterEach, describe, expect, it, vi } from "vitest";
import { tableCsvFile } from "./table-csv";

const f = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { get: f.get, query: f.query },
}));

const table = {
  id: "t1",
  title: "Leads",
  columns: [
    { id: "c1", name: "Name", type: "text" },
    { id: "c2", name: "Score", type: "number" },
  ],
};

afterEach(() => vi.clearAllMocks());

describe("tableCsvFile", () => {
  it("snapshots every live row of the whole Table, page by page, as a dated CSV", async () => {
    f.get.mockResolvedValue(table);
    f.query
      .mockResolvedValueOnce({
        rows: [{ values: { c1: "Ada", c2: 5 } }],
        nextCursor: "p2",
      })
      .mockResolvedValueOnce({
        rows: [{ values: { c1: "Bo, Jr.", c2: null } }],
        nextCursor: null,
      });

    const file = await tableCsvFile("t1", new Date(2026, 10, 23, 15));

    expect(file?.name).toBe("Leads (2026-11-23).csv");
    expect(file?.type).toBe("text/csv");
    expect(await file?.text()).toBe(
      '"Name","Score"\r\n"Ada","5"\r\n"Bo, Jr.",""',
    );
    expect(f.query).toHaveBeenNthCalledWith(1, "t1", {
      limit: 100,
      cursor: undefined,
      archived: false,
    });
    expect(f.query).toHaveBeenNthCalledWith(2, "t1", {
      limit: 100,
      cursor: "p2",
      archived: false,
    });
  });

  it("gives nothing back for a Table over the 10,000-row export limit", async () => {
    f.get.mockResolvedValue(table);
    f.query.mockResolvedValue({
      rows: Array.from({ length: 100 }, () => ({ values: {} })),
      nextCursor: "more",
    });

    expect(await tableCsvFile("t1", new Date())).toBeNull();
    expect(f.query).toHaveBeenCalledTimes(101);
  });
});
