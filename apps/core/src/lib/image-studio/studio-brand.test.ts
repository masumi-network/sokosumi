import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectFindUniqueMock,
  projectFindUniqueOrThrowMock,
  importProductsMock,
  suggestProfileMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  projectFindUniqueMock: vi.fn(),
  projectFindUniqueOrThrowMock: vi.fn(),
  importProductsMock: vi.fn(),
  suggestProfileMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findUnique: projectFindUniqueMock,
      findUniqueOrThrow: projectFindUniqueOrThrowMock,
    },
  },
}));

vi.mock("@/lib/image-studio/product-import", () => ({
  importStudioProducts: importProductsMock,
}));

vi.mock("@/lib/image-studio/website-brand-profile", () => ({
  suggestWebsiteBrandProfile: suggestProfileMock,
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { LIMITS } from "@/config/constants";
import {
  applyStudioBrandPrompt,
  loadStudioBrand,
  prepareStudioWebsiteDraft,
  readStudioBrandKit,
  readStudioWebsiteCopy,
} from "@/lib/image-studio/studio-brand";

const DESIGN_MD_URL =
  "https://abc123.public.blob.vercel-storage.com/design-md/hash.md";

describe("applyStudioBrandPrompt", () => {
  it("includes approved lines alongside the generation brief", () => {
    const prompt = applyStudioBrandPrompt("Launch ad", {
      designMd: null,
      memory: null,
      brandBrain: null,
      approvedLines: "Made from reclaimed clay.",
    });
    expect(prompt).toContain(
      "Approved ad copy (use where relevant):\nMade from reclaimed clay.",
    );
    expect(prompt).toMatch(/Brief:\nLaunch ad$/);
  });
  it("leaves the brief alone when Design and Memory are empty", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: null,
        memory: null,
        brandBrain: null,
      }),
    ).toBe("a red fox");
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "  ",
        memory: "\n",
        brandBrain: null,
      }),
    ).toBe("a red fox");
  });

  it("prefixes Design and Memory and keeps the brief last", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand\nUse crimson.",
        memory: "We never use serif.",
        brandBrain: null,
      }),
    ).toBe(
      [
        "Follow this project's brand.",
        "Design:\n# Brand\nUse crimson.",
        "Memory:\nWe never use serif.",
        "Brief:\na red fox",
      ].join("\n\n"),
    );
  });

  it("omits a missing half", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand",
        memory: null,
        brandBrain: null,
      }),
    ).toContain("Design:\n# Brand");
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand",
        memory: null,
        brandBrain: null,
      }),
    ).not.toContain("Memory:");
  });

  it("puts the Brand Brain first", () => {
    expect(
      applyStudioBrandPrompt("a red fox", {
        designMd: "# Brand",
        memory: null,
        brandBrain: "Acme sells rockets.",
      }),
    ).toBe(
      [
        "Follow this project's brand.",
        "Brand Brain:\nAcme sells rockets.",
        "Design:\n# Brand",
        "Brief:\na red fox",
      ].join("\n\n"),
    );
  });

  it("clips a long brand block", () => {
    const designMd = "x".repeat(2000);
    const prompt = applyStudioBrandPrompt("brief", {
      designMd,
      memory: null,
      brandBrain: null,
    });
    expect(prompt).toContain("x".repeat(1600));
    expect(prompt).not.toContain("x".repeat(1601));
  });
});

describe("readStudioBrandKit", () => {
  it("loads approved copy and the visual details from the existing project sources", async () => {
    const version = new Date("2026-11-09T12:00:00.000Z");
    const logo =
      "https://abc123.public.blob.vercel-storage.com/projects/project-1/logos/hash";
    projectFindUniqueOrThrowMock.mockResolvedValueOnce({
      logo,
      designMdUrl:
        "https://abc123.public.blob.vercel-storage.com/design-md/brand-kit-hash.md",
      brandBrain: {
        updatedAt: version,
        body: {
          summary: "A ceramics studio",
          voice: {
            tone: "Direct",
            do: [],
            dont: [],
            examples: ["Made from reclaimed clay."],
          },
          audience: ["Home cooks"],
          products: [],
          competitors: [],
          channels: [],
        },
      },
    });
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response(
        'colors:\n  primary: "#a33421"\ntypography:\n  heading:\n    fontFamily: "Inter"',
      ),
    );
    await expect(readStudioBrandKit("project-1")).resolves.toEqual({
      logo,
      colors: ["#a33421"],
      fonts: ["Inter"],
      summary: "A ceramics studio",
      tone: "Direct",
      audience: ["Home cooks"],
      approvedLines: ["Made from reclaimed clay."],
      version: version.toISOString(),
    });
  });
});

describe("readStudioWebsiteCopy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the stored website and returns its description and distinct main headings", async () => {
    const websiteUrl = "https://fieldwork.example";
    projectFindUniqueOrThrowMock.mockResolvedValueOnce({ websiteUrl });
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response(
        `<head><meta name="description" content="Coffee &amp; gear."></head>
         <header><h2>Sign in</h2></header>
         <main><h1>Brew at your own pace.</h1>
           <h2>Good coffee, <em>anywhere</em>.</h2>
           <h2>Good coffee, anywhere.</h2>
           <h2>Coffee &amp; gear.</h2>
         </main>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      ),
    );
    await expect(readStudioWebsiteCopy("project-1")).resolves.toEqual({
      summary: "Coffee & gear.",
      lines: ["Brew at your own pace.", "Good coffee, anywhere."],
    });
    expect(projectFindUniqueOrThrowMock).toHaveBeenCalledExactlyOnceWith({
      where: { id: "project-1" },
      select: { websiteUrl: true },
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledExactlyOnceWith(
      `${websiteUrl}/`,
      expect.objectContaining({ maxResponseBytes: expect.any(Number) }),
    );
  });

  it("reports missing and unreachable websites without modifying the brand kit", async () => {
    projectFindUniqueOrThrowMock.mockResolvedValueOnce({ websiteUrl: null });
    await expect(readStudioWebsiteCopy("project-1")).rejects.toMatchObject({
      status: 422,
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();

    projectFindUniqueOrThrowMock.mockResolvedValueOnce({
      websiteUrl: "https://fieldwork.example",
    });
    ssrfSafeFetchMock.mockRejectedValueOnce(new Error("fetch blocked"));
    await expect(readStudioWebsiteCopy("project-1")).rejects.toMatchObject({
      status: 502,
    });
  });
});

describe("prepareStudioWebsiteDraft", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the same saved website for both suggestions", async () => {
    const websiteUrl = "https://fieldwork.example/shop";
    const product = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Pour-over set",
      description: "",
      price: "$48",
      url: `${websiteUrl}/pour-over`,
      imageUrl: null,
    };
    projectFindUniqueOrThrowMock.mockResolvedValueOnce({ websiteUrl });
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response(
        "<main><h1>Brew at your own pace.</h1><p>For home coffee enthusiasts.</p></main>",
        {
          headers: { "Content-Type": "text/html" },
        },
      ),
    );
    importProductsMock.mockResolvedValueOnce([product]);
    suggestProfileMock.mockResolvedValueOnce({
      tone: "Warm and relaxed",
      audience: ["Home coffee enthusiasts"],
    });

    await expect(
      prepareStudioWebsiteDraft("project-1", "workspace-a"),
    ).resolves.toEqual({
      brandCopy: {
        summary: null,
        lines: ["Brew at your own pace."],
        tone: "Warm and relaxed",
        audience: ["Home coffee enthusiasts"],
      },
      products: [product],
    });
    expect(projectFindUniqueOrThrowMock).toHaveBeenCalledTimes(1);
    expect(ssrfSafeFetchMock).toHaveBeenCalledExactlyOnceWith(
      websiteUrl,
      expect.any(Object),
    );
    expect(importProductsMock).toHaveBeenCalledExactlyOnceWith(
      websiteUrl,
      "workspace-a",
    );
    expect(suggestProfileMock).toHaveBeenCalledExactlyOnceWith(
      "workspace-a",
      "Brew at your own pace.\nFor home coffee enthusiasts.",
    );
  });

  it("returns usable copy when product discovery fails", async () => {
    projectFindUniqueOrThrowMock.mockResolvedValueOnce({
      websiteUrl: "https://fieldwork.example",
    });
    ssrfSafeFetchMock.mockResolvedValueOnce(
      new Response("<h1>Freshly roasted.</h1>", {
        headers: { "Content-Type": "text/html" },
      }),
    );
    importProductsMock.mockRejectedValueOnce(
      new Error("Storefront unavailable"),
    );

    await expect(prepareStudioWebsiteDraft("project-1")).resolves.toEqual({
      brandCopy: { summary: null, lines: ["Freshly roasted."] },
      products: null,
    });
    expect(suggestProfileMock).not.toHaveBeenCalled();
  });
});

describe("loadStudioBrand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads Memory from the project and Design from the blob", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: DESIGN_MD_URL,
      contextMd: "  We never use serif.  ",
    });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("# Brand\nUse crimson.", { status: 200 }),
    );

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: "# Brand\nUse crimson.",
      memory: "We never use serif.",
      brandBrain: null,
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(DESIGN_MD_URL, {
      maxResponseBytes: LIMITS.DESIGN_MD_MAX_SIZE_BYTES,
    });
  });

  it("skips a Design URL that is not a stored blob", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: "https://evil.example/design-md/hash.md",
      contextMd: "Keep the fox.",
    });

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: null,
    });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("includes colors and fonts from the end of a long project design guide", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl:
        "https://abc123.public.blob.vercel-storage.com/design-md/long-style.md",
      contextMd: null,
    });
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(
        `# Brand\n${"Introduction. ".repeat(160)}\ncolors:\n  primary: "#a33421"\ntypography:\n  heading:\n    fontFamily: "Inter"`,
      ),
    );

    const brand = await loadStudioBrand("project-1");
    expect(brand.designMd).toHaveLength(1600);
    const prompt = applyStudioBrandPrompt("Launch ad", brand);
    expect(prompt).toContain("Brand colors: #a33421\nBrand fonts: Inter");
    expect(prompt).toMatch(/Brief:\nLaunch ad$/);
  });

  it("fails open when the project or Design cannot be read", async () => {
    projectFindUniqueMock.mockRejectedValue(new Error("db down"));
    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: null,
      brandBrain: null,
    });

    projectFindUniqueMock.mockResolvedValue({
      // A file no earlier test read: read files are cached by URL.
      designMdUrl:
        "https://abc123.public.blob.vercel-storage.com/design-md/unread.md",
      contextMd: "Keep the fox.",
    });
    ssrfSafeFetchMock.mockRejectedValue(new Error("blocked"));
    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: null,
    });
  });

  it("reads the Project's Brand Brain: who the business is and sounds like", async () => {
    projectFindUniqueMock.mockResolvedValue({
      designMdUrl: null,
      contextMd: null,
      brandBrain: {
        body: {
          summary: "Acme sells rockets to founders.",
          voice: { tone: "Direct and warm", do: [], dont: [], examples: [] },
          audience: ["Founders", "Engineers"],
          products: ["Rockets"],
          competitors: [],
          channels: [],
        },
      },
    });

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: null,
      brandBrain: [
        "Acme sells rockets to founders.",
        "Voice: Direct and warm",
        "Audience: Founders; Engineers",
        "Products: Rockets",
      ].join("\n"),
    });
  });
});
