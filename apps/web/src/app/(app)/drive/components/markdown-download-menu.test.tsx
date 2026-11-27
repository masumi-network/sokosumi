import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EXPORT_MAX_BYTES } from "@/lib/utils/export-operation";

import { MarkdownDownloadMenu } from "./markdown-download-menu";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { loading: vi.fn(() => "t"), error: vi.fn(), dismiss: vi.fn() },
}));

const CONTENT = "/api/drive/files/f-1/content?scope=me";
const DOWNLOAD = `${CONTENT}&download=true`;

function stubExport(markdown: string) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? new Response(new Blob(["doc"]))
      : new Response(markdown),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // The export saves through an <a download>; happy-dom would follow it.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return fetchMock;
}

async function open(props: { fileName?: string; sizeBytes?: number | null }) {
  const user = userEvent.setup();
  render(
    <MarkdownDownloadMenu
      url={CONTENT}
      downloadUrl={DOWNLOAD}
      fileName={props.fileName ?? "Q3 plan.md"}
      sizeBytes={props.sizeBytes ?? null}
    />,
  );
  await user.click(screen.getByRole("button", { name: "previewDownload" }));
  return user;
}

async function choose(item: string, props = {}) {
  const user = await open(props);
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("MarkdownDownloadMenu", () => {
  beforeEach(() => vi.mocked(toast.error).mockClear());

  it("offers the original file as a plain download link", async () => {
    stubExport("");
    await open({});
    const original = await screen.findByRole("menuitem", {
      name: "previewDownloadOriginal",
    });
    expect(original).toHaveAttribute("href", DOWNLOAD);
    expect(original).toHaveAttribute("download", "Q3 plan.md");
  });

  it("reads the file and exports its Markdown as a PDF named after it", async () => {
    const fetchMock = stubExport("# Launch\n\nShip it.");
    await choose("exportAsPdf");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(CONTENT);
    const [route, init] = fetchMock.mock.calls[1] ?? [];
    expect(route).toBe("/api/export/pdf");
    const body = JSON.parse(String(init?.body));
    expect(body.fileName).toBe("Q3 plan");
    expect(body.html).toContain("<h1");
    expect(body.html).toContain("Ship it.");
  });

  it("names a copy of a file without an extension after the whole name", async () => {
    const fetchMock = stubExport("# Readme");
    await choose("exportAsPdf", { fileName: "v1.2 README" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).fileName,
    ).toBe("v1.2 README");
  });

  it("keeps only the original for a file known to be over the export limit", async () => {
    const fetchMock = stubExport("");
    await open({ sizeBytes: EXPORT_MAX_BYTES + 1 });

    expect(
      await screen.findByRole("menuitem", { name: "previewDownloadOriginal" }),
    ).not.toHaveAttribute("aria-disabled", "true");
    for (const name of ["exportAsPdf", "exportAsDocx"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
    expect(screen.getByText("previewExportTooLarge")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops reading a file of unknown size once it passes the limit and says why", async () => {
    const fetchMock = stubExport("x".repeat(EXPORT_MAX_BYTES + 1));
    await choose("exportAsDocx");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("exportTooLarge"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not send a PDF whose rendered page is over the limit", async () => {
    // Under the limit as Markdown, over it once every cell becomes HTML.
    const row = "| a | b | c | d |\n";
    const table = `| h | h | h | h |\n| - | - | - | - |\n${row.repeat(
      Math.floor((EXPORT_MAX_BYTES * 0.9) / row.length),
    )}`;
    const fetchMock = stubExport(table);
    await choose("exportAsPdf");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("exportTooLarge"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
