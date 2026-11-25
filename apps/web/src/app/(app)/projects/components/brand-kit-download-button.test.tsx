import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

const archive = vi.hoisted(() => ({
  createFilesArchive: vi.fn(),
  saveZip: vi.fn(),
}));
vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  ...archive,
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import {
  BrandKitDownloadButton,
  brandKitFiles,
} from "./brand-kit-download-button";

const MARKDOWN =
  "---\ncolors:\n  primary: '#2F7D4F'\n  link: '{colors.primary}'\ntypography:\n  display:\n    fontFamily: Inter\n    fontSize: 30px\n    fontWeight: '300'\n---\n## Voice\n\nPlain words.\n";
const LABELS = { colors: "Colors", typography: "Typography" };

function decode(url: string) {
  const [, body] = url.split(",");
  return decodeURIComponent(body ?? "");
}

describe("brandKitFiles", () => {
  it("bundles DESIGN.md, the colours and fonts as text, and the logo", () => {
    const files = brandKitFiles({
      markdown: MARKDOWN,
      logo: {
        url: "https://blob.test/projects/p/logos/abc",
        type: "image/svg+xml",
      },
      labels: LABELS,
    });

    expect(files.map((file) => file.name)).toEqual([
      "DESIGN.md",
      "brand.txt",
      "logo.svg",
    ]);
    expect(decode(files[0].fileUrl)).toBe(MARKDOWN);
    expect(decode(files[1].fileUrl)).toBe(
      "Colors\nprimary: #2F7D4F\nlink: {colors.primary}\n\nTypography\ndisplay: Inter · 30px · 300\n",
    );
    expect(files[2].fileUrl).toBe("https://blob.test/projects/p/logos/abc");
  });

  it("leaves out the logo and the token file when there are none", () => {
    const files = brandKitFiles({
      markdown: "# Brand\n",
      logo: null,
      labels: LABELS,
    });

    expect(files.map((file) => file.name)).toEqual(["DESIGN.md"]);
  });

  it.each([
    ["image/jpeg", "logo.jpg"],
    ["image/webp; charset=binary", "logo.webp"],
    ["image/png", "logo.png"],
    [null, "logo.png"],
  ])("names a %s logo %s", (type, name) => {
    const files = brandKitFiles({
      markdown: "# Brand\n",
      logo: { url: "https://blob.test/projects/p/logos/abc", type },
      labels: LABELS,
    });

    expect(files.at(-1)?.name).toBe(name);
  });
});

describe("BrandKitDownloadButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("names the logo after the type the store serves it as", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    archive.createFilesArchive.mockResolvedValue({
      data: new ArrayBuffer(1),
      included: [],
      missing: [],
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandKitDownloadButton
          projectName="Launch plan"
          markdown="# Brand"
          logoUrl="https://blob.test/projects/p/logos/abc"
        />
      </NextIntlClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Download brand kit" }),
    );

    await waitFor(() => expect(archive.saveZip).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.test/projects/p/logos/abc",
      expect.objectContaining({ method: "HEAD" }),
    );
    expect(
      archive.createFilesArchive.mock.calls[0][0].map(
        (file: { name: string }) => file.name,
      ),
    ).toEqual(["DESIGN.md", "logo.jpg"]);
  });

  it("saves the kit as a zip named after the project", async () => {
    archive.createFilesArchive.mockResolvedValue({
      data: new ArrayBuffer(1),
      included: ["DESIGN.md"],
      missing: [],
    });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <BrandKitDownloadButton
          projectName="Launch plan"
          markdown={MARKDOWN}
          logoUrl={null}
        />
      </NextIntlClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Download brand kit" }),
    );

    await waitFor(() =>
      expect(archive.saveZip).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "Launch plan brand kit",
      ),
    );
    expect(
      archive.createFilesArchive.mock.calls[0][0].map(
        (file: { name: string }) => file.name,
      ),
    ).toEqual(["DESIGN.md", "brand.txt"]);
  });
});
