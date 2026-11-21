import { beforeEach, expect, it, vi } from "vitest";

const { create, batch } = vi.hoisted(() => ({
  create: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { create, batch },
}));

import { finishTableCopy, type TableCopy, tableCopyRows } from "./table-copy";

const plan = {
  table: { key: "k" } as TableCopy["plan"]["table"],
  batches: [
    { key: "k:0", insert: [{}, {}], patch: [] },
    { key: "k:1", insert: [{}], patch: [] },
  ] as unknown as TableCopy["plan"]["batches"],
};

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "table-1" });
  batch.mockReset().mockResolvedValue({});
});

it("creates the Table once and resumes at the first batch not saved", async () => {
  batch.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("offline"));
  const copy: TableCopy = { plan, done: 0 };
  await expect(finishTableCopy(copy)).rejects.toThrow("offline");
  expect(copy).toMatchObject({ tableId: "table-1", done: 1 });
  expect(tableCopyRows(copy)).toEqual({ saved: 2, total: 3 });

  await expect(finishTableCopy(copy)).resolves.toBe("table-1");
  expect(create).toHaveBeenCalledTimes(1);
  expect(batch.mock.calls.map(([, body]) => body.key)).toEqual([
    "k:0",
    "k:1",
    "k:1",
  ]);
  expect(tableCopyRows(copy)).toEqual({ saved: 3, total: 3 });
});
