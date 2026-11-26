import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectUpdate: vi.fn(),
  projectUpdateMany: vi.fn(),
  readBrandVisual: vi.fn(),
  siteIcon: vi.fn(),
  upload: vi.fn(),
  readDesignMd: vi.fn(),
  fetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: mocks.fetch }));
vi.mock("@/services/cuso-project-files.service", () => ({
  cusoDrive: async () => ({ projectId: "project-1" }),
  saveCusoProjectFile: mocks.save,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      update: mocks.projectUpdate,
      updateMany: mocks.projectUpdateMany,
    },
  },
}));
vi.mock("@/lib/brand-visual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/brand-visual")>()),
  readBrandVisual: mocks.readBrandVisual,
}));
vi.mock("@/lib/site-icon", () => ({
  resolveSiteIconAsProjectLogo: mocks.siteIcon,
}));
vi.mock("@/lib/design-md-blob", () => ({
  uploadDesignMdContent: mocks.upload,
  readDesignMdContent: mocks.readDesignMd,
}));
// No DESIGN.md API: brand capture writes the site's own look instead.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), MASUMI_DESIGN_MD_API_KEY: undefined }),
  };
});

import sharp from "sharp";

import {
  cmoBrandVisual,
  learnCmoBrandVisual,
  logoPng,
  saveCmoBrandLogo,
} from "./cmo-brand-visual.service";

const cuso = {
  projectId: "project-1",
  websiteUrl: "https://acme.io",
  workspaceId: "ws-1",
  sokoBotId: "bot-1",
};

const WORDMARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 30"><rect width="120" height="30" fill="#000"/></svg>';

describe("the brand's logo files", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.save.mockReset().mockResolvedValue("file-1");
  });

  it("saves the full logo, its dark version and the mark a DESIGN.md names, as PNGs", async () => {
    mocks.fetch.mockImplementation(async () => new Response(WORDMARK));
    const saved = await saveCmoBrandLogo(
      cuso,
      [
        "---",
        "name: Acme",
        "logo:",
        "  src: https://acme.io/logo.svg",
        '  srcDark: "https://acme.io/logo-white.svg"',
        "  mark: https://acme.io/icon.svg",
        "colors:",
        '  primary: "#ff6a00"',
        "---",
      ].join("\n"),
    );
    expect(saved).toBe(3);
    expect(mocks.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://acme.io/logo.svg",
      "https://acme.io/logo-white.svg",
      "https://acme.io/icon.svg",
    ]);
    expect(
      mocks.save.mock.calls.map(([, target, , type]) => [target, type]),
    ).toEqual([
      [{ folder: "Brand research/Logo", filename: "logo.png" }, "image/png"],
      [
        { folder: "Brand research/Logo", filename: "logo-dark.png" },
        "image/png",
      ],
      [{ folder: "Brand research/Logo", filename: "mark.png" }, "image/png"],
    ]);
  });

  // Sites often paint a header logo white with CSS on a dark hero; the
  // DESIGN.md then names that white file as the logo for a light page.
  const WHITE_WORDMARK = WORDMARK.replace('fill="#000"', 'fill="white"');
  const logoOnly = (srcDark?: string) =>
    [
      "---",
      "name: Acme",
      "logo:",
      "  src: https://acme.io/logo.svg",
      ...(srcDark ? [`  srcDark: ${srcDark}`] : []),
      "---",
    ].join("\n");

  it("keeps a white-only logo as the version for a dark background", async () => {
    mocks.fetch.mockImplementation(async () => new Response(WHITE_WORDMARK));
    expect(await saveCmoBrandLogo(cuso, logoOnly())).toBe(1);
    expect(mocks.save.mock.calls.map(([, target]) => target)).toEqual([
      { folder: "Brand research/Logo", filename: "logo-dark.png" },
    ]);
  });

  it("drops a white-only logo when the DESIGN.md names a dark version too", async () => {
    mocks.fetch.mockImplementation(async () => new Response(WHITE_WORDMARK));
    expect(
      await saveCmoBrandLogo(cuso, logoOnly("https://acme.io/logo-white.svg")),
    ).toBe(1);
    expect(mocks.save.mock.calls.map(([, target]) => target)).toEqual([
      { folder: "Brand research/Logo", filename: "logo-dark.png" },
    ]);
  });

  it("saves nothing for a DESIGN.md without a logo", async () => {
    expect(await saveCmoBrandLogo(cuso, "---\nname: Acme\n---\n")).toBe(0);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("draws a small SVG at full width and never enlarges a bitmap", async () => {
    const svg = await logoPng(Buffer.from(WORDMARK));
    expect((await sharp(svg as Buffer).metadata()).width).toBe(1024);
    const small = await sharp({
      create: { width: 40, height: 20, channels: 4, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(
      (await sharp((await logoPng(small)) as Buffer).metadata()).width,
    ).toBe(40);
    expect(await logoPng(Buffer.from("not a picture"))).toBeNull();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readBrandVisual.mockResolvedValue({
    logoUrl: "https://acme.io/logo.svg",
    colors: ["#ff6a00", "#1a73e8"],
    fonts: ["Inter"],
    siteName: "Acme Rockets",
    images: [],
  });
  mocks.siteIcon.mockResolvedValue("https://blob.example/logo.png");
  mocks.upload.mockResolvedValue("https://blob.example/DESIGN.md");
});

describe("brand capture", () => {
  it("writes the Project's logo and a DESIGN.md of the site's look, nothing on the hire", async () => {
    await learnCmoBrandVisual(cuso);

    expect(mocks.projectUpdateMany).toHaveBeenCalledWith({
      where: { id: "project-1", logo: null },
      data: {
        logo: "https://blob.example/logo.png",
        projectRevision: { increment: 1 },
      },
    });
    expect(mocks.projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        designMdUrl: "https://blob.example/DESIGN.md",
        designMdExtractionId: null,
      },
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({ owner: { kind: "project", id: "project-1" } }),
    );
  });

  it("reads back what it wrote as the brand's look", async () => {
    await learnCmoBrandVisual(cuso);
    const written = mocks.upload.mock.calls[0]?.[0].content as string;
    mocks.readDesignMd.mockResolvedValue(written);

    expect(
      await cmoBrandVisual(
        {
          logo: "https://blob.example/logo.png",
          designMdUrl: "https://blob.example/DESIGN.md",
        },
        ["https://blob.example/01-red-sneaker.jpg"],
      ),
    ).toEqual({
      logoUrl: "https://blob.example/logo.png",
      colors: ["#ff6a00", "#1a73e8"],
      fonts: ["Inter"],
      siteName: "Acme Rockets",
      designMdUrl: "https://blob.example/DESIGN.md",
      images: ["https://blob.example/01-red-sneaker.jpg"],
    });
  });
});

describe("cmoBrandVisual", () => {
  it("gives the palette with its black and white, never the error colours", async () => {
    mocks.readDesignMd.mockResolvedValue(
      [
        "---",
        "name: CMO.XYZ",
        "colors:",
        "  primary: '#ff51ff'",
        "  secondary: '#000000'",
        "  error: '#ba1a1a'",
        "  on-error-container: '#410002'",
        "  background: '#ffffff'",
        "  on-background: '#000000'",
        "---",
        "Errors are `#ba1a1a` on `#ffdad6`.",
      ].join("\n"),
    );
    expect(
      await cmoBrandVisual(
        { logo: null, designMdUrl: "https://blob/d.md" },
        [],
      ),
    ).toMatchObject({ colors: ["#ff51ff", "#000000", "#ffffff"] });
  });

  it("reads colours, fonts and name from a DESIGN.md the API wrote", async () => {
    mocks.readDesignMd.mockResolvedValue(
      [
        "---",
        "name: Plausible Analytics",
        "colors:",
        '  primary: "#6400FF"',
        "typography:",
        "  body:",
        "    fontFamily: Inter, sans-serif",
        "---",
        "Accent: `#6a05ff`",
      ].join("\n"),
    );
    expect(
      await cmoBrandVisual(
        { logo: null, designMdUrl: "https://blob/d.md" },
        [],
      ),
    ).toMatchObject({
      colors: ["#6400ff"],
      fonts: ["Inter"],
      siteName: "Plausible Analytics",
    });
  });

  it("is null when the Project has neither logo nor DESIGN.md", async () => {
    expect(await cmoBrandVisual({ logo: null, designMdUrl: null }, [])).toBe(
      null,
    );
  });
});
