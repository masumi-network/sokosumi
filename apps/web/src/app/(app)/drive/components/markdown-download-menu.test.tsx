import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { exportBaseName, MarkdownDownloadMenu } from "./markdown-download-menu";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

async function choose(item: string) {
  const user = userEvent.setup();
  render(
    <MarkdownDownloadMenu
      url={CONTENT}
      downloadUrl={DOWNLOAD}
      fileName="Q3 plan.md"
    />,
  );
  await user.click(screen.getByRole("button", { name: "previewDownload" }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

describe("MarkdownDownloadMenu", () => {
  it("offers the original file as a plain download link", async () => {
    stubExport("");
    const user = userEvent.setup();
    render(
      <MarkdownDownloadMenu
        url={CONTENT}
        downloadUrl={DOWNLOAD}
        fileName="Q3 plan.md"
      />,
    );
    await user.click(screen.getByRole("button", { name: "previewDownload" }));
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

  it.each([
    ["notes.md", "notes"],
    ["v1.2 release.markdown", "v1.2 release"],
    ["README", "README"],
  ])("names the copy of %s %s", (name, expected) => {
    expect(exportBaseName(name)).toBe(expected);
  });
});
