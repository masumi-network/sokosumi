import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import JSZip from "jszip";
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
  name = "Leads.csv",
  kind?: "csv" | "xlsx",
) {
  const fetch =
    typeof response === "function"
      ? vi.fn(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { gcTime: Number.POSITIVE_INFINITY },
            mutations: { gcTime: Number.POSITIVE_INFINITY },
          },
        })
      }
    >
      <TableCreateDialog
        workspaceId={null}
        sourceFile={{ url: URL, name, kind }}
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

  it("scrolls a field that gets focus into view, even when focus wraps without scrolling", async () => {
    openFromFiles(new Response("Name,Zip\nAda,007\n"));
    await screen.findByText("007");
    const scrollIntoView = vi.fn();
    const title = screen.getByLabelText("title");
    title.scrollIntoView = scrollIntoView;

    // Focus starts on the title; it leaves, as it does for the Close button,
    // and Radix brings it back to the first field with `preventScroll`.
    act(() => screen.getByLabelText("description").focus());
    act(() => title.focus({ preventScroll: true }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("separates the file's name and counts in the description it announces", async () => {
    openFromFiles(new Response("Name,Zip\nAda,007\n"));
    await screen.findByText("007");

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      /^Leads\.csv · rowCount.* · columnCount/,
    );
  });

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

    expect(await screen.findByText("loadingFile")).toBeTruthy();
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

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A workbook whose cells are inline text, one sheet per entry. */
async function xlsx(sheets: Record<string, string[][]>) {
  const zip = new JSZip();
  const names = Object.keys(sheets);
  zip.file(
    "xl/workbook.xml",
    `<workbook xmlns="${MAIN}" xmlns:r="r"><sheets>${names
      .map(
        (n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships>${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
  );
  names.forEach((n, i) => {
    const rows = sheets[n]
      .map(
        (row) =>
          `<row>${row.map((text) => `<c t="inlineStr"><is><t>${text}</t></is></c>`).join("")}</row>`,
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return new Response(await zip.generateAsync({ type: "arraybuffer" }));
}

describe("TableCreateDialog from a Files Excel workbook", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("maps the chosen sheet and creates the Table from its rows", async () => {
    openFromFiles(
      await xlsx({
        Leads: [
          ["Name", "Zip"],
          ["Ada", "007"],
        ],
        Notes: [["Topic"], ["Hi"]],
      }),
      "Plan.xlsx",
    );

    expect(await screen.findByText("007")).toBeTruthy();
    expect(screen.getByLabelText("title")).toHaveValue("Plan");
    const sheet = screen.getByLabelText("sheet");
    expect(
      Array.from((sheet as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(["Leads", "Notes"]);

    fireEvent.change(sheet, { target: { value: "1" } });
    expect(await screen.findByText("Hi")).toBeTruthy();
    const names = screen.getAllByLabelText("columnName");
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual([
      "Topic",
    ]);

    f.create.mockResolvedValue({ id: "table-1" });
    f.batch.mockResolvedValue({});
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() =>
      expect(f.push).toHaveBeenCalledWith("/drive/tables/table-1"),
    );
    expect(f.create.mock.calls[0][0].title).toBe("Plan");
    expect(Object.values(f.batch.mock.calls[0][1].insert[0].values)).toEqual([
      "Hi",
    ]);
  });

  it("offers no sheet choice for one sheet, and names a blank header", async () => {
    openFromFiles(
      await xlsx({
        Only: [
          ["Name", ""],
          ["Ada", "x"],
        ],
      }),
      "One.xlsx",
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.queryByLabelText("sheet")).toBeNull();
    const names = screen.getAllByLabelText("columnName");
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual([
      "Name",
      'untitledColumn {"number":2}',
    ]);
  });

  it("reads a workbook known by its type, not its name, such as one renamed without .xlsx", async () => {
    openFromFiles(
      await xlsx({
        Leads: [
          ["Name", "Zip"],
          ["Ada", "007"],
        ],
      }),
      "Leads",
      "xlsx",
    );

    expect(await screen.findByText("007")).toBeTruthy();
    expect(screen.getByLabelText("title")).toHaveValue("Leads");
    expect(
      screen
        .getAllByLabelText("columnName")
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(["Name", "Zip"]);
  });

  it("opens on the first sheet with rows, past a blank cover sheet", async () => {
    openFromFiles(
      await xlsx({ Cover: [], Leads: [["Name"], ["Ada"]] }),
      "Plan.xlsx",
    );

    expect(await screen.findByText("Ada")).toBeTruthy();
    expect(screen.getByLabelText("sheet")).toHaveValue("1");
    expect(screen.queryByText("sheetEmpty")).toBeNull();
  });

  it("says a workbook with no rows at all has nothing to import", async () => {
    openFromFiles(await xlsx({ Cover: [] }), "Blank.xlsx");

    expect(await screen.findByText("workbookEmpty")).toBeTruthy();
  });

  it("says an unreadable workbook could not be read and offers another workbook", async () => {
    openFromFiles(new Response("not a workbook"), "Broken.xlsx");

    expect(await screen.findByText("errors.sheet")).toBeTruthy();
    expect(screen.queryByLabelText("columnName")).toBeNull();
    // Recovery names the kind it takes: another workbook, not a CSV.
    expect(screen.getByLabelText("importXlsx")).toHaveAttribute(
      "accept",
      ".xlsx",
    );
  });

  it("says before creating when the sheet is larger than a Table takes", async () => {
    // Cells without an `r` reference: their position is their order.
    const wide = Array.from({ length: 120 }, (_, i) => `C${i}`);
    openFromFiles(await xlsx({ Wide: [wide, wide] }), "Wide.xlsx");

    // Names the limit that applies and the sheet's own count, nothing else.
    expect(
      await screen.findByText('sheetCutColumns {"count":120,"limit":100}'),
    ).toBeTruthy();
    expect(screen.queryByText(/sheetCutRows/)).toBeNull();
    expect(screen.getAllByLabelText("columnName")).toHaveLength(100);
    expect(screen.getByRole("button", { name: "create" })).toBeEnabled();
  });

  it("says how many data rows a sheet has past the Table's 10,000", async () => {
    const rows = Array.from({ length: 10_002 }, (_, i) => [`r${i}`]);
    openFromFiles(await xlsx({ Long: [["Name"], ...rows] }), "Long.xlsx");

    expect(
      await screen.findByText(
        'sheetCutRows {"count":10002,"limit":10000}',
        {},
        { timeout: 10_000 },
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/sheetCutColumns/)).toBeNull();
  }, 20_000);
});
