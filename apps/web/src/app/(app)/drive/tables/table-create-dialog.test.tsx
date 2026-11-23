import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableCreateDialog } from "./table-create-dialog";

const f = vi.hoisted(() => ({
  create: vi.fn(),
  batch: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: f.push }) }));
vi.mock("@/lib/services/data-table.client", () => ({
  dataTableService: {
    projects: () => Promise.resolve([]),
    create: f.create,
    batch: f.batch,
  },
}));

const URL = "/api/drive/files/res-1/content?scope=me";

function openFromFiles(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TableCreateDialog
        workspaceId={null}
        csvFile={{ url: URL, name: "Leads.csv" }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "openAsTable" }));
  return fetch;
}

describe("TableCreateDialog from a Files CSV", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens with the file's columns, preview and name, then creates the Table", async () => {
    const fetch = openFromFiles(new Response("Name,Zip\nAda,007\n"));

    expect(await screen.findByText("007")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(URL);
    expect(screen.getByLabelText("title")).toHaveValue("Leads");
    const names = screen.getAllByLabelText("columnName");
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual([
      "Name",
      "Zip",
    ]);

    f.create.mockResolvedValue({ id: "table-1" });
    f.batch.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(f.push).toHaveBeenCalledWith("/drive/tables/table-1"),
    );
    expect(f.create.mock.calls[0][0].title).toBe("Leads");
    expect(Object.values(f.batch.mock.calls[0][1].insert[0].values)).toEqual([
      "Ada",
      "007",
    ]);
  });

  it("says the file could not be read and offers no mapping", async () => {
    openFromFiles(new Response("", { status: 404 }));

    expect(await screen.findByText("errors.missing")).toBeTruthy();
    expect(screen.queryByLabelText("columnName")).toBeNull();
  });
});
