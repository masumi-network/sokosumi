import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectUpdate: vi.fn(),
  readBrandVisual: vi.fn(),
  siteIcon: vi.fn(),
  upload: vi.fn(),
  readDesignMd: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { update: mocks.projectUpdate },
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

import {
  cmoBrandVisual,
  learnCmoBrandVisual,
} from "./cmo-brand-visual.service";

const cuso = {
  id: "cuso-1",
  projectId: "project-1",
  websiteUrl: "https://acme.io",
};

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

    expect(mocks.projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { logo: "https://blob.example/logo.png" },
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
