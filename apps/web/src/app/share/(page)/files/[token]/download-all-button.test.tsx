import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../../messages/en.json";

const toast = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));
const saveZip = vi.hoisted(() => vi.fn());
vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  saveZip,
}));

import { SharedFolderDownloadAllButton } from "./download-all-button";

const ROUTE = "/share/files/tok%2F1/download?path=";

function renderButton(paths: string[]) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SharedFolderDownloadAllButton
        token="tok/1"
        name="Spring launch"
        paths={paths}
        label={en.Share.Files.downloadAll}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("button", { name: "Download all" });
}

describe("SharedFolderDownloadAllButton", () => {
  const fetchFile = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchFile);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("zips the shared files through the link, keeping their folders", async () => {
    fetchFile.mockImplementation(
      async (url: string) => new Response(decodeURIComponent(url)),
    );

    await userEvent.click(
      renderButton(["brief.txt", "Brand/team.csv", "Brand/Logos/colors.txt"]),
    );

    await waitFor(() => expect(saveZip).toHaveBeenCalledOnce());
    // Only the link's own route, which re-checks the link for each file.
    expect(fetchFile.mock.calls.map(([url]) => url)).toEqual([
      `${ROUTE}brief.txt`,
      `${ROUTE}Brand%2Fteam.csv`,
      `${ROUTE}Brand%2FLogos%2Fcolors.txt`,
    ]);
    const [data, name] = saveZip.mock.calls[0];
    expect(name).toBe("Spring launch");
    const zip = await JSZip.loadAsync(data);
    expect(
      Object.keys(zip.files).filter((path) => !zip.files[path].dir),
    ).toEqual(["brief.txt", "Brand/team.csv", "Brand/Logos/colors.txt"]);
    expect(await zip.file("Brand/team.csv")?.async("text")).toContain(
      "path=Brand/team.csv",
    );
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("leaves out a file the link no longer serves and names it", async () => {
    // The route sends a refused file (revoked link, data room) back to the page.
    fetchFile.mockImplementation(async (url: string) =>
      url.includes("Board")
        ? new Response("<html>", { status: 404 })
        : new Response("x"),
    );

    await userEvent.click(renderButton(["brief.txt", "Board/minutes.pdf"]));

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Downloaded 1 of 2 files. Not included: Board/minutes.pdf. Open them one by one.",
        { duration: 15_000 },
      ),
    );
    const zip = await JSZip.loadAsync(saveZip.mock.calls[0][0]);
    expect(Object.keys(zip.files)).toEqual(["brief.txt"]);
  });

  it("saves nothing when the link serves no file", async () => {
    fetchFile.mockResolvedValue(new Response("", { status: 404 }));

    await userEvent.click(renderButton(["a.txt", "b.txt"]));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't download the files. Try again, or open them one by one.",
      ),
    );
    expect(saveZip).not.toHaveBeenCalled();
  });
});
