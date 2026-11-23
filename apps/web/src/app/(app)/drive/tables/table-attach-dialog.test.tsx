import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableAttachDialog } from "./table-attach-dialog";

const f = vi.hoisted(() => ({ list: vi.fn(), file: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "Nov 23, 2026" }),
}));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: { list: f.list },
}));
vi.mock("./table-csv", () => ({ tableCsvFile: f.file }));

function renderDialog() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TableAttachDialog onClose={onClose} onPick={onPick} />
    </QueryClientProvider>,
  );
  return { onPick, onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TableAttachDialog", () => {
  it("hands back the picked Table as a CSV file and closes", async () => {
    f.list.mockResolvedValue({
      items: [
        { id: "t1", title: "Leads", columnCount: 3, updatedAt: new Date() },
      ],
    });
    const csv = new File(["a"], "Leads (2026-11-23).csv");
    f.file.mockResolvedValue(csv);
    const { onPick, onClose } = renderDialog();

    const row = await screen.findByRole("button", { name: /Leads/ });
    fireEvent.click(row);

    await waitFor(() => expect(row).toBeEnabled());
    expect(onPick).toHaveBeenCalledWith(csv);
    expect(f.file).toHaveBeenCalledWith("t1", expect.any(Date));
    expect(onClose).toHaveBeenCalled();
  });

  it("says why a Table over the row limit can't be added, and stays open", async () => {
    f.list.mockResolvedValue({
      items: [
        { id: "t1", title: "Huge", columnCount: 3, updatedAt: new Date() },
      ],
    });
    f.file.mockResolvedValue(null);
    const { onPick, onClose } = renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: /Huge/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("tooLarge");
    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("points to Files when there are no Tables yet", async () => {
    f.list.mockResolvedValue({ items: [] });
    renderDialog();

    expect(await screen.findByText("empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "openTables" })).toHaveAttribute(
      "href",
      "/drive?view=tables",
    );
  });
});
