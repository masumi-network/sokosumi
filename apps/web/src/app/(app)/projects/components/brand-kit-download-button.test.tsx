import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import JSZip from "jszip";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../../../messages/en.json";

// The real archive builder runs; only the browser save is caught.
const saveZip = vi.hoisted(() => vi.fn());
vi.mock("@/lib/files-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files-archive")>()),
  saveZip,
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { BrandKitDownloadButton } from "./brand-kit-download-button";

const MARKDOWN =
  "---\ncolors:\n  primary: '#2F7D4F'\n  link: '{colors.primary}'\ntypography:\n  display:\n    fontFamily: Inter\n    fontSize: 30px\n    fontWeight: '300'\n---\n## Voice\n\nPlain words.\n";
// The store keeps logos under a content hash, with no extension.
const LOGO_URL = "https://blob.test/projects/p/logos/7f4d16e3";

/** Serves the logo as `type` (HEAD and GET) and the text entries' data URLs. */
function serveLogo(type: string | null, bytes: Uint8Array<ArrayBuffer>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("data:")) {
      return new Response(decodeURIComponent(url.slice(url.indexOf(",") + 1)));
    }
    const headers = type ? { "content-type": type } : undefined;
    return new Response(init?.method === "HEAD" ? null : bytes, { headers });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function downloadKit(markdown: string, logoUrl: string | null) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <BrandKitDownloadButton
        projectName="Launch plan"
        markdown={markdown}
        logoUrl={logoUrl}
      />
    </NextIntlClientProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Download brand kit" }),
  );
  await waitFor(() => expect(saveZip).toHaveBeenCalled());
  const [data, name] = saveZip.mock.calls[0];
  return { name, zip: await JSZip.loadAsync(data) };
}

describe("BrandKitDownloadButton", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("zips DESIGN.md, its colours and type as text, and the logo", async () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'/>",
    );
    serveLogo("image/svg+xml", svg);

    const { name, zip } = await downloadKit(MARKDOWN, LOGO_URL);

    expect(name).toBe("Launch plan brand kit");
    expect(Object.keys(zip.files)).toEqual([
      "DESIGN.md",
      "brand.txt",
      "logo.svg",
    ]);
    expect(await zip.file("DESIGN.md")?.async("string")).toBe(MARKDOWN);
    expect(await zip.file("brand.txt")?.async("string")).toBe(
      "Colors\nprimary: #2F7D4F\nlink: {colors.primary}\n\nTypography\ndisplay: Inter · 30px · 300\n",
    );
    expect(await zip.file("logo.svg")?.async("uint8array")).toEqual(svg);
  });

  it.each([
    ["image/jpeg", "logo.jpg"],
    ["image/webp; charset=binary", "logo.webp"],
    ["image/x-icon", "logo.ico"],
    ["image/vnd.microsoft.icon", "logo.ico"],
    ["image/png", "logo.png"],
    // Unknown: no extension rather than a wrong one.
    ["application/octet-stream", "logo"],
    [null, "logo"],
  ])(
    "names an extensionless %s logo %s with its bytes",
    async (type, entry) => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      const fetchMock = serveLogo(type, bytes);

      const { zip } = await downloadKit("# Brand\n", LOGO_URL);

      expect(fetchMock).toHaveBeenCalledWith(
        LOGO_URL,
        expect.objectContaining({ method: "HEAD" }),
      );
      expect(Object.keys(zip.files)).toEqual(["DESIGN.md", entry]);
      expect(await zip.file(entry)?.async("uint8array")).toEqual(bytes);
    },
  );

  it("leaves out the logo and the token file when there are none", async () => {
    const fetchMock = serveLogo(null, new Uint8Array());

    const { zip } = await downloadKit("# Brand\n", null);

    expect(Object.keys(zip.files)).toEqual(["DESIGN.md"]);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("blob.test"),
      expect.anything(),
    );
  });
});
