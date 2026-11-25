import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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

function openFromFiles(
  response: Response | Promise<Response> | (() => Promise<Response>),
) {
  const fetch =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response);
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
    expect(fetch).toHaveBeenCalledWith(URL, expect.anything());
    expect(screen.getByLabelText("title")).toHaveValue("Leads");
    // The header names the file, so its picker is not offered again.
    expect(screen.getByText("Leads.csv")).toBeTruthy();
    expect(screen.queryByLabelText("importCsv")).toBeNull();
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

    expect(await screen.findByText("fileMissing")).toBeTruthy();
    expect(screen.getByText("Leads.csv")).toBeTruthy();
    expect(screen.queryByLabelText("columnName")).toBeNull();
  });

  it.each([
    ["could not be read", new Response("", { status: 404 }), "fileMissing"],
    [
      "is not a readable CSV",
      new Response('Name\n"open quote\n'),
      "errors.csv",
    ],
  ])(
    "offers the picker to recover when the file %s",
    async (_case, response, message) => {
      openFromFiles(response);

      expect(await screen.findByText(message)).toBeTruthy();
      fireEvent.change(screen.getByLabelText("importCsv"), {
        target: { files: [new File(["Name,Zip\nAda,007\n"], "Fixed.csv")] },
      });

      expect(await screen.findByText("007")).toBeTruthy();
      expect(screen.getByText("Fixed.csv")).toBeTruthy();
      expect(screen.queryByLabelText("importCsv")).toBeNull();
      expect(screen.getByRole("button", { name: "create" })).toBeEnabled();
    },
  );

  it("shows each column's first filled values, read once from the file", async () => {
    openFromFiles(
      new Response("Name,Zip\nAda,\n,0101\nBo,0202\nCy,0303\nDi,0404\n"),
    );

    expect(await screen.findByText("Ada · Bo · Cy")).toBeTruthy();
    expect(screen.getByText("0101 · 0202 · 0303")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "Renamed" },
    });
    expect(screen.getByText("Ada · Bo · Cy")).toBeTruthy();
  });

  it("never creates an empty Table when the file is not a readable CSV", async () => {
    openFromFiles(new Response('Name\n"open quote\n'));

    expect(await screen.findByText("errors.csv")).toBeTruthy();
    const create = screen.getByRole("button", { name: "create" });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("refuses a file over 5 MB from its length, closing it unread", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      headers: { "content-length": "6000000" },
    });
    const getReader = vi.spyOn(
      response.body as ReadableStream<Uint8Array>,
      "getReader",
    );
    openFromFiles(response);

    expect(await screen.findByText("csvLimit")).toBeTruthy();
    expect(cancel).toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("columnName")).toBeNull();
  });

  it("keeps a title typed while the file is still loading", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    openFromFiles(() => promise);

    const title = await screen.findByLabelText("title");
    expect(title).toHaveValue("Leads");
    fireEvent.change(title, { target: { value: "Spring leads" } });
    await act(async () => resolve(new Response("Name,Zip\nAda,007\n")));

    expect(await screen.findByText("007")).toBeTruthy();
    expect(screen.getByLabelText("title")).toHaveValue("Spring leads");
  });

  it("stops reading a file of unknown length once it passes 5 MB", async () => {
    const chunk = new Uint8Array(1_000_000).fill(65);
    let pulled = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
      cancel,
    });
    openFromFiles(new Response(body));

    expect(await screen.findByText("csvLimit")).toBeTruthy();
    expect(cancel).toHaveBeenCalled();
    expect(pulled).toBeLessThan(10);
  });

  it("announces the read and can be closed while it runs, cancelling it", async () => {
    let signal: AbortSignal | undefined;
    openFromFiles(
      () =>
        new Promise<Response>((_resolve, reject) => {
          signal = (
            fetch as unknown as { mock: { calls: [string, RequestInit][] } }
          ).mock.calls[0][1].signal as AbortSignal;
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    expect(await screen.findByText("loadingCsv")).toBeTruthy();
    expect(screen.getByText("Leads.csv")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(signal?.aborted).toBe(true);
  });

  it("says the request failed, in the app's words, when the network drops", async () => {
    openFromFiles(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(await screen.findByText("errors.request")).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
