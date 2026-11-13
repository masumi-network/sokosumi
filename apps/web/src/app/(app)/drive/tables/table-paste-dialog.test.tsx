import type { TableColumn } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TablePasteDialog } from "./table-paste-dialog";

const batch = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { batch },
}));

const column = (id: number, name: string, type: TableColumn["type"]) => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  tableId: "00000000-0000-4000-8000-000000000009",
  name,
  type,
  options: [],
  position: id,
  version: 1,
  width: null,
  wrap: null,
});
const columns = [column(1, "Company", "text"), column(2, "Seats", "number")];

it("adds pasted cells as new rows, leaving out a repeated header", async () => {
  batch.mockResolvedValue({});
  const added = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <TablePasteDialog
      tableId={columns[0].tableId}
      columns={columns}
      text={"Company\tSeats\nAcme\t3\nGlobex\t5\n"}
      onClose={close}
      onAdded={added}
    />,
  );
  expect(screen.getByText("Globex")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "addPastedRows:2" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(batch).toHaveBeenCalledWith(
    columns[0].tableId,
    expect.objectContaining({
      insert: [
        {
          values: { [columns[0].id]: "Acme", [columns[1].id]: 3 },
          evidence: {},
        },
        {
          values: { [columns[0].id]: "Globex", [columns[1].id]: 5 },
          evidence: {},
        },
      ],
    }),
  );
  expect(added).toHaveBeenCalled();
});

it("names the row a pasted value fails in and adds nothing", async () => {
  batch.mockClear();
  render(
    <TablePasteDialog
      tableId={columns[0].tableId}
      columns={columns}
      text={"Acme\tmany"}
      onClose={() => {}}
      onAdded={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "addPastedRows:1" }));
  expect(await screen.findByText("row 1: errors.number")).toBeTruthy();
  expect(batch).not.toHaveBeenCalled();
});

it("shows rows from batches that landed when a later batch fails", async () => {
  batch.mockReset();
  batch.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("offline"));
  const added = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(
    <TablePasteDialog
      tableId={columns[0].tableId}
      columns={columns}
      text={Array.from({ length: 120 }, (_, i) => `Row ${i}\t${i}`).join("\n")}
      onClose={close}
      onAdded={added}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "addPastedRows:120" }));
  expect(await screen.findByText("offline")).toBeTruthy();
  expect(batch).toHaveBeenCalledTimes(2);
  expect(added).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
