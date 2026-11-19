import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

const {
  projectFindUniqueMock,
  projectFindUniqueOrThrowMock,
  importProductsMock,
  suggestProfileMock,
  readBrandVisualMock,
  resolveWebsiteLogoMock,
  ssrfSafeFetchMock,
} = vi.hoisted(() => ({
  projectFindUniqueMock: vi.fn(),
  projectFindUniqueOrThrowMock: vi.fn(),
  importProductsMock: vi.fn(),
  suggestProfileMock: vi.fn(),
  readBrandVisualMock: vi.fn(),
  resolveWebsiteLogoMock: vi.fn(),
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

vi.mock("@/lib/brand-visual", () => ({
  readBrandVisual: readBrandVisualMock,
}));

vi.mock("@/lib/design-md-blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/design-md-blob")>();
  return {
    ...actual,
    readDesignMdContent: vi.fn(actual.readDesignMdContent),
  };
});

vi.mock("@/lib/site-icon", () => ({
  resolveStudioWebsiteLogo: resolveWebsiteLogoMock,
}));

vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { LIMITS } from "@/config/constants";
import { readDesignMdContent } from "@/lib/design-md-blob";
import {
  applyStudioBrandPrompt,
  buildStudioLetteringPrompt,
  loadStudioBrand,
  prepareStudioWebsiteDraft,
  readStudioBrandKit,
  readStudioWebsiteCopy,
} from "@/lib/image-studio/studio-brand";

const DESIGN_MD_URL =
  "https://abc123.public.blob.vercel-storage.com/design-md/hash.md";

describe("buildStudioLetteringPrompt", () => {
  it("includes only the approved headline and effective palette and font direction", () => {
    const prompt = buildStudioLetteringPrompt("Made for every day.", {
      colors: ["#6400ff"],
      fonts: ["Space Grotesk"],
    });
    expect(prompt).toContain('"Made for every day."');
    expect(prompt).toContain("#6400ff");
    expect(prompt).toContain("Space Grotesk");
    expect(prompt).toContain("Preserve the product");
    expect(prompt).not.toContain("Studio adds");
  });
});

describe("applyStudioBrandPrompt", () => {
  it("gives structured colors and fonts precedence and keeps the brief last", () => {
    const brief = "Launch ad";
    const prompt = applyStudioBrandPrompt(brief, {
      designMd: "Use blue and Georgia.",
      memory: null,
      brandBrain: null,
      look: { colors: ["#a33421", "#112233"], fonts: ["Inter"] },
    });

    expect(prompt).toContain(
      "Use these Studio choices for the ad's palette and fonts. They take precedence over any palette or typefaces in the other brand context.",
    );
    expect(prompt).toContain("Palette: #a33421, #112233");
    expect(prompt).toContain("Fonts: Inter");
    expect(prompt).toMatch(/Brief:\nLaunch ad$/);
  });

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
      studioLogoPosition: "top-left",
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
      studioLogoPosition: "top-left",
      colors: ["#a33421"],
      fonts: ["Inter"],
      lookRevision: 0,
      hasCustomLook: false,
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

  it("prepares brand, products and visual suggestions from the same saved website", async () => {
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
    const logo =
      "https://abc123.public.blob.vercel-storage.com/projects/project-1/logos/sample.png";
    readBrandVisualMock.mockResolvedValueOnce({
      colors: ["#123456"],
      fonts: ["Inter"],
    });
    resolveWebsiteLogoMock.mockResolvedValueOnce(logo);

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
      visual: { colors: ["#123456"], fonts: ["Inter"], logo },
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
    expect(readBrandVisualMock).toHaveBeenCalledExactlyOnceWith(websiteUrl, {
      includeDeclaredNeutrals: true,
    });
    expect(resolveWebsiteLogoMock).toHaveBeenCalledExactlyOnceWith(
      websiteUrl,
      "project-1",
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
    expect(resolveWebsiteLogoMock).not.toHaveBeenCalled();
  });
});

describe("loadStudioBrand", () => {
  const readDesignMdContentMock = vi.mocked(readDesignMdContent);
  const websiteUrl = "https://fieldwork.example";
  const brandBrain = {
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
  };
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    vi.resetAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
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
    expect(brand.look).toEqual({ colors: ["#a33421"], fonts: ["Inter"] });
    const prompt = applyStudioBrandPrompt("Launch ad", brand);
    expect(prompt).toContain("Palette: #a33421");
    expect(prompt).toContain("Fonts: Inter");
    expect(prompt).not.toContain("Brand colors:");
    expect(prompt).not.toContain("Brand fonts:");
    expect(prompt.match(/#a33421/g)).toHaveLength(1);
    expect(prompt).toMatch(/Brief:\nLaunch ad$/);
  });

  it("fails open when the project or Design cannot be read", async () => {
    projectFindUniqueMock.mockRejectedValue(new Error("db down"));
    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: null,
      brandBrain: null,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[image-studio] Could not load project brand",
      { projectId: "project-1", detail: "db down" },
    );

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
    expect(warnSpy).toHaveBeenCalledWith(
      "[image-studio] Could not read DESIGN.md",
      { projectId: "project-1", detail: "unknown" },
    );
  });

  it("uses the saved custom look ahead of DESIGN.md and the website", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      studioBrandLook: { colors: ["#ABC", "#A33421"], fonts: ["Inter"] },
      contextMd: null,
    });
    readDesignMdContentMock.mockResolvedValueOnce(
      'colors:\n  primary: "#123456"\ntypography:\n  fontFamily: "Georgia"',
    );

    const brand = await loadStudioBrand("project-1");
    expect(brand.look).toEqual({
      colors: ["#aabbcc", "#a33421"],
      fonts: ["Inter"],
    });
    const prompt = applyStudioBrandPrompt("Launch ad", brand);
    expect(prompt).toContain("Palette: #aabbcc, #a33421");
    expect(prompt).toContain("Fonts: Inter");
    expect(prompt).not.toContain("Palette: #123456");
    expect(readBrandVisualMock).not.toHaveBeenCalled();
    expect(projectFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "project-1" },
      select: {
        designMdUrl: true,
        websiteUrl: true,
        studioBrandLook: true,
        contextMd: true,
        brandBrain: { select: { body: true } },
      },
    });
  });

  it("keeps an empty saved look authoritative", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      studioBrandLook: { colors: [], fonts: [] },
      contextMd: null,
    });
    readDesignMdContentMock.mockResolvedValueOnce(
      'colors:\n  primary: "#a33421"\ntypography:\n  fontFamily: "Inter"',
    );

    const brand = await loadStudioBrand("project-1");
    expect(brand.look).toEqual({ colors: [], fonts: [] });
    const prompt = applyStudioBrandPrompt("Launch ad", brand);
    expect(prompt).toContain("Palette: No fixed palette");
    expect(prompt).toContain("Fonts: No fixed fonts");
    expect(readBrandVisualMock).not.toHaveBeenCalled();
  });

  it.each([null, { colors: ["invalid"], fonts: ["Inter"] }])(
    "uses DESIGN.md colors and fonts when the saved look is %j",
    async (studioBrandLook) => {
      const design =
        'colors:\n  primary: "#A33421"\n  secondary: "#25A1CC"\ntypography:\n  heading:\n    fontFamily: "Inter"\n  body:\n    fontFamily: "Source Sans Pro"';
      projectFindUniqueMock.mockResolvedValueOnce({
        designMdUrl: DESIGN_MD_URL,
        websiteUrl,
        studioBrandLook,
        contextMd: null,
      });
      readDesignMdContentMock.mockResolvedValueOnce(design);

      const brand = await loadStudioBrand("project-1");
      expect(brand.designMd).toBe(design);
      expect(brand.look).toEqual({
        colors: ["#a33421", "#25a1cc"],
        fonts: ["Inter", "Source Sans Pro"],
      });
      const prompt = applyStudioBrandPrompt("Launch ad", brand);
      expect(prompt).toContain("Palette: #a33421, #25a1cc");
      expect(prompt).toContain("Fonts: Inter, Source Sans Pro");
      expect(prompt).toMatch(/Brief:\nLaunch ad$/);
      expect(readBrandVisualMock).not.toHaveBeenCalled();
    },
  );

  it("uses a fonts-only DESIGN.md look without requesting the website", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      studioBrandLook: null,
      contextMd: null,
    });
    readDesignMdContentMock.mockResolvedValueOnce('fontFamily: "Inter"');

    const brand = await loadStudioBrand("project-1");
    expect(brand.look).toEqual({ colors: [], fonts: ["Inter"] });
    expect(applyStudioBrandPrompt("Launch ad", brand)).toContain(
      "Fonts: Inter",
    );
    expect(readBrandVisualMock).not.toHaveBeenCalled();
  });

  it("uses the website visual when DESIGN.md has no colors or fonts", async () => {
    vi.useFakeTimers();
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      studioBrandLook: null,
      contextMd: "Keep the fox.",
    });
    readDesignMdContentMock.mockResolvedValueOnce("# Brand\nKeep it simple.");
    readBrandVisualMock.mockResolvedValueOnce({
      colors: ["#A33421", "#fff"],
      fonts: ["Inter"],
    });

    const brand = await loadStudioBrand("project-1");
    expect(brand.look).toEqual({
      colors: ["#a33421", "#ffffff"],
      fonts: ["Inter"],
    });
    const prompt = applyStudioBrandPrompt("Launch ad", brand);
    expect(prompt).toContain("Palette: #a33421, #ffffff");
    expect(prompt).toContain("Fonts: Inter");
    expect(readBrandVisualMock).toHaveBeenCalledExactlyOnceWith(websiteUrl, {
      includeDeclaredNeutrals: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps the website look and filters long font names before taking four", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: null,
      websiteUrl,
      contextMd: null,
    });
    const colors = [
      "#ABC",
      "#A33421",
      "#123456",
      "#FEDCBA",
      "#DDFFBB",
      "#114477",
      "#FFFFFF",
      "#222222",
      "#990011",
    ];
    readBrandVisualMock.mockResolvedValueOnce({
      colors,
      fonts: ["a".repeat(81), "Inter", "Lato", "Roboto", "Open Sans", "Ubuntu"],
    });

    const brand = await loadStudioBrand("project-1");
    expect(brand.look).toEqual({
      colors: [
        "#aabbcc",
        "#a33421",
        "#123456",
        "#fedcba",
        "#ddffbb",
        "#114477",
        "#ffffff",
        "#222222",
      ],
      fonts: ["Inter", "Lato", "Roboto", "Open Sans"],
    });
  });

  it("falls back to the website when DESIGN.md contains only an oversized font", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      contextMd: null,
    });
    readDesignMdContentMock.mockResolvedValueOnce(
      `fontFamily: "${"a".repeat(81)}"`,
    );
    readBrandVisualMock.mockResolvedValueOnce({ colors: [], fonts: ["Inter"] });

    expect((await loadStudioBrand("project-1")).look).toEqual({
      colors: [],
      fonts: ["Inter"],
    });
    expect(readBrandVisualMock).toHaveBeenCalledTimes(1);
  });

  it("logs a thrown DESIGN.md read and preserves the saved look, Brain and memory", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      studioBrandLook: { colors: ["#A33421"], fonts: ["Inter"] },
      contextMd: "Keep the fox.",
      brandBrain,
    });
    readDesignMdContentMock.mockRejectedValueOnce(
      new Error("Design unavailable"),
    );

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: "A ceramics studio\nVoice: Direct\nAudience: Home cooks",
      approvedLines: "Made from reclaimed clay.",
      look: { colors: ["#a33421"], fonts: ["Inter"] },
    });
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      "[image-studio] Could not read DESIGN.md",
      { projectId: "project-1", detail: "Design unavailable" },
    );
    expect(readBrandVisualMock).not.toHaveBeenCalled();
  });

  it("continues to the website after a DESIGN.md failure", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      contextMd: "Keep the fox.",
      brandBrain,
    });
    readDesignMdContentMock.mockRejectedValueOnce(
      new Error("Design unavailable"),
    );
    readBrandVisualMock.mockResolvedValueOnce({
      colors: ["#A33421"],
      fonts: ["Inter"],
    });

    await expect(loadStudioBrand("project-1")).resolves.toMatchObject({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: "A ceramics studio\nVoice: Direct\nAudience: Home cooks",
      approvedLines: "Made from reclaimed clay.",
      look: { colors: ["#a33421"], fonts: ["Inter"] },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[image-studio] Could not read DESIGN.md",
      { projectId: "project-1", detail: "Design unavailable" },
    );
  });

  it("logs a website failure and keeps DESIGN.md, Brain and memory", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: DESIGN_MD_URL,
      websiteUrl,
      contextMd: "Keep the fox.",
      brandBrain,
    });
    readDesignMdContentMock.mockResolvedValueOnce("# Brand\nKeep it simple.");
    readBrandVisualMock.mockRejectedValueOnce(new Error("Website unavailable"));

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: "# Brand\nKeep it simple.",
      memory: "Keep the fox.",
      brandBrain: "A ceramics studio\nVoice: Direct\nAudience: Home cooks",
      approvedLines: "Made from reclaimed clay.",
    });
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      "[image-studio] Could not read website visual",
      { projectId: "project-1", detail: "Website unavailable" },
    );
  });

  it("logs an empty website result without setting an empty fallback look", async () => {
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: null,
      websiteUrl,
      contextMd: "Keep the fox.",
      brandBrain,
    });
    readBrandVisualMock.mockResolvedValueOnce({ colors: [], fonts: [] });

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: "A ceramics studio\nVoice: Direct\nAudience: Home cooks",
      approvedLines: "Made from reclaimed clay.",
    });
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      "[image-studio] Website visual has no colors or fonts",
      { projectId: "project-1", detail: "unknown" },
    );
  });

  it("bounds a hung website read at nine seconds and keeps Brain and memory", async () => {
    vi.useFakeTimers();
    projectFindUniqueMock.mockResolvedValueOnce({
      designMdUrl: null,
      websiteUrl,
      contextMd: "Keep the fox.",
      brandBrain,
    });
    readBrandVisualMock.mockImplementationOnce(() => new Promise(() => {}));
    const loading = loadStudioBrand("project-1");

    await vi.advanceTimersByTimeAsync(9_000);

    await expect(loading).resolves.toEqual({
      designMd: null,
      memory: "Keep the fox.",
      brandBrain: "A ceramics studio\nVoice: Direct\nAudience: Home cooks",
      approvedLines: "Made from reclaimed clay.",
    });
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
      "[image-studio] Could not read website visual",
      { projectId: "project-1", detail: "Website visual timed out" },
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns no brand for a missing project without reading other sources", async () => {
    projectFindUniqueMock.mockResolvedValueOnce(null);

    await expect(loadStudioBrand("project-1")).resolves.toEqual({
      designMd: null,
      memory: null,
      brandBrain: null,
    });
    expect(readDesignMdContentMock).not.toHaveBeenCalled();
    expect(readBrandVisualMock).not.toHaveBeenCalled();
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
