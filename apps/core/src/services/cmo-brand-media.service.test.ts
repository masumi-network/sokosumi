import type { BrandBrain } from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const db = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  fileResource: { findUnique: vi.fn() },
  fileProjectLink: { findFirst: vi.fn(), findMany: vi.fn() },
}));
const files = vi.hoisted(() => ({
  put: vi.fn(),
  list: vi.fn(),
  reserve: vi.fn(),
  activate: vi.fn(),
  updateFileMetadata: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), BLOB_READ_WRITE_TOKEN: "t" }),
  };
});
vi.mock("@vercel/blob", () => ({ put: files.put, list: files.list }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: vi.fn(),
}));
vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveUploadResource: files.reserve,
  activateDriveUploadResource: files.activate,
}));
vi.mock("@/services/file-metadata.service", () => ({
  updateFileMetadata: files.updateFileMetadata,
}));
const cuso = vi.hoisted(() => ({ findForBot: vi.fn() }));
vi.mock("@/services/cmo-cuso.service", () => ({
  cmoRunnerUserId: async () => "user-1",
  findCusoForBot: cuso.findForBot,
}));
vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/jpeg" },
    }),
}));
const site = vi.hoisted(() => ({
  robots: vi.fn(),
  sitemap: vi.fn(),
}));
vi.mock("@/lib/site-pages", () => ({
  readRobots: site.robots,
  readSitemapPages: site.sitemap,
}));
vi.mock("@/lib/site-capture", () => ({
  DESKTOP: { width: 1440, height: 900 },
  MOBILE: { width: 390, height: 844 },
  withBrowser: (work: (browser: unknown) => unknown) => work({}),
  capturePage: async (
    _browser: unknown,
    url: string,
    viewport?: { sections?: number; fullScreens?: number },
  ) => {
    const own = new URL(url).hostname === "acme.io";
    return {
      url: url.endsWith("/moved-home") ? "https://acme.io/" : url,
      title: "Acme",
      screenshot: Buffer.from("shot"),
      images: own
        ? [
            {
              url: "https://acme.io/sneaker.jpg",
              width: 1200,
              height: 900,
              alt: "Red sneaker on white",
            },
          ]
        : [],
      links: own
        ? [
            {
              url: "https://acme.io/pricing",
              text: "Pricing",
              place: "header",
            },
            { url: "https://acme.io/login", text: "Log in", place: "header" },
          ]
        : [],
      ...(viewport?.fullScreens ? { fullPage: Buffer.from("full") } : {}),
      sections: viewport?.sections
        ? [
            {
              kind: "pricing",
              title: "Plans: Starter & Pro",
              screenshot: Buffer.from("section"),
            },
          ]
        : [],
    };
  },
}));

import {
  captureCmoBrandMedia,
  captureCmoHomepage,
  cmoBrandMedia,
  cmoCompetitorPages,
  cmoOwnPages,
  listCmoBrandPictures,
  scheduleCmoBrandMedia,
} from "./cmo-brand-media.service";

const finding = (sourceUrl: string) => ({
  point: "A finding.",
  evidence: "fact" as const,
  confidence: "high" as const,
  sourceUrl,
});

function brain(extra: Partial<BrandBrain>): BrandBrain {
  return {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: [],
    products: [],
    offers: [],
    competitors: [],
    alternatives: [],
    channels: [],
    profile: {},
    questions: [],
    ...extra,
  };
}

describe("cmoOwnPages", () => {
  it("takes the homepage, then one cited pricing, product and customers page", () => {
    const pages = cmoOwnPages(
      "https://www.acme.io/start",
      brain({
        offers: [
          {
            name: "Pro",
            what: "A rocket",
            price: "$49",
            url: "https://acme.io/pricing?plan=pro",
          },
        ],
        profile: {
          company: {
            answer: "Rockets.",
            findings: [
              finding("https://acme.io/about"),
              finding("https://acme.io/features/launch"),
              finding("https://acme.io/customers"),
              finding("https://elsewhere.example/pricing"),
              finding("https://acme.io/blog/post"),
            ],
            openQuestions: [],
          },
        },
      }),
    );
    expect(pages).toEqual([
      { label: "Home", url: "https://www.acme.io/" },
      { label: "Pricing", url: "https://acme.io/pricing" },
      { label: "Product", url: "https://acme.io/features/launch" },
      { label: "Customers", url: "https://acme.io/customers" },
      { label: "About", url: "https://acme.io/about" },
      { label: "Blog", url: "https://acme.io/blog/post" },
    ]);
  });

  it("fills in the pages the site links and lists, the section's own page first", () => {
    const pages = cmoOwnPages("https://acme.io", brain({}), [
      "https://acme.io/blog/why-our-pricing-changed",
      "https://acme.io/login",
      "https://acme.io/plans",
      "https://acme.io/blog",
      "https://acme.io/docs/api/authentication",
      "https://acme.io/docs",
      "https://other.example/about",
    ]);
    expect(pages).toEqual([
      { label: "Home", url: "https://acme.io/" },
      { label: "Pricing", url: "https://acme.io/plans" },
      { label: "Blog", url: "https://acme.io/blog" },
      { label: "Docs", url: "https://acme.io/docs" },
    ]);
  });

  it("never reads an about page as pricing, and tries /pricing when none was cited", () => {
    const pages = cmoOwnPages(
      "https://acme.io",
      brain({
        profile: {
          company: {
            answer: "Rockets.",
            findings: [finding("https://acme.io/about")],
            openQuestions: [],
          },
        },
      }),
    );
    expect(pages).toEqual([
      { label: "Home", url: "https://acme.io/" },
      { label: "Pricing", url: "https://acme.io/pricing" },
      { label: "About", url: "https://acme.io/about" },
    ]);
  });
});

describe("cmoCompetitorPages", () => {
  it("captures each competitor's homepage, at most eight", () => {
    const pages = cmoCompetitorPages(
      brain({
        competitors: [
          { name: "No link" },
          ...Array.from({ length: 10 }, (_, index) => ({
            name: `Rival ${index}`,
            url: `https://rival${index}.example/product?ref=x`,
          })),
        ],
      }),
    );
    expect(pages).toHaveLength(8);
    expect(pages[0]).toEqual({
      name: "Rival 0",
      url: "https://rival0.example/",
    });
  });
});

const ORG = "drive/organizations/org-1/Brand research";

function researchFile(id: string, path: string) {
  return { resource: { id, sourceId: `${ORG}/${path}` } };
}

describe("captureCmoBrandMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cuso.findForBot.mockResolvedValue({
      sokoBotId: "bot-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
      brandBrain: brain({
        competitors: [{ name: "Rival Co", url: "https://rival.example/x" }],
      }),
    });
    db.workspace.findUnique.mockResolvedValue({ organizationId: "org-1" });
    db.fileProjectLink.findFirst.mockResolvedValue(null);
    db.fileResource.findUnique.mockResolvedValue({ metadataRevision: 3 });
    files.put.mockImplementation(async (pathname: string) => ({
      url: `https://blob.example/${pathname}`,
    }));
    files.reserve.mockResolvedValue({ resourceId: "r", versionId: "v" });
    files.activate.mockImplementation(
      async ({ key }: { key: { pathname: string } }) => ({
        resourceId: `file:${key.pathname.split("/").pop()}`,
      }),
    );
    files.updateFileMetadata.mockResolvedValue({ status: "applied" });
    site.robots.mockResolvedValue({ allows: () => true, sitemaps: [] });
    site.sitemap.mockResolvedValue(["https://acme.io/about"]);
  });

  it("saves each page, its sections and the pictures as the Project's files under Brand research", async () => {
    await captureCmoBrandMedia("bot-1");

    const saved = files.put.mock.calls.map(([pathname]) => pathname);
    expect(saved.sort()).toEqual(
      [
        // The homepage, the page its header links and the one its sitemap lists.
        ...["home", "pricing", "about"].flatMap((page) => [
          `${ORG}/${page}.jpg`,
          `${ORG}/${page}-mobile.jpg`,
          `${ORG}/Full pages/${page}.jpg`,
          `${ORG}/Sections/${page}-01-pricing-plans-starter-pro.jpg`,
        ]),
        `${ORG}/Competitors/rival-co.jpg`,
        `${ORG}/Pictures/01-red-sneaker-on-white.jpg`,
        `${ORG}/index.json`,
      ].sort(),
    );
    const index = files.put.mock.calls.find(([pathname]) =>
      pathname.endsWith("/index.json"),
    );
    expect(JSON.parse(String(index?.[1]))).toMatchObject({
      pages: [
        { name: "home", url: "https://acme.io/", title: "Acme" },
        { name: "pricing", url: "https://acme.io/pricing" },
        { name: "about", url: "https://acme.io/about" },
      ],
      sections: expect.arrayContaining([
        {
          name: "pricing-01-pricing-plans-starter-pro",
          title: "Plans: Starter & Pro",
          pageUrl: "https://acme.io/pricing",
        },
      ]),
    });
    // Each file is linked to Cuso's Project, so every member sees it there.
    const linked = files.updateFileMetadata.mock.calls.map(([input]) => input);
    expect(linked).toContainEqual(
      expect.objectContaining({
        workspaceId: "ws-1",
        resourceId: "file:01-red-sneaker-on-white.jpg",
        request: {
          expectedMetadataRevision: 3,
          confirmProjectIds: ["project-1"],
        },
      }),
    );
    expect(linked).toHaveLength(files.put.mock.calls.length);
  });

  it("reads only what robots.txt allows", async () => {
    site.robots.mockImplementation(async (origin: string) => ({
      allows: (path: string) =>
        new URL(origin).hostname === "acme.io" && path !== "/pricing",
      sitemaps: [],
    }));
    await captureCmoBrandMedia("bot-1");
    const saved = files.put.mock.calls.map(([pathname]) => pathname);
    expect(saved).toContain(`${ORG}/home.jpg`);
    expect(saved).toContain(`${ORG}/about.jpg`);
    expect(saved.filter((path) => /pricing\.|rival/.test(path))).toEqual([]);

    files.put.mockClear();
    site.robots.mockResolvedValue({ allows: () => false, sitemaps: [] });
    await captureCmoBrandMedia("bot-1");
    await captureCmoHomepage({
      sokoBotId: "bot-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
    });
    expect(files.put).not.toHaveBeenCalled();
  });

  it("keeps one copy of a page two addresses lead to", async () => {
    // The site sends visitors of its old company page to the homepage.
    site.sitemap.mockResolvedValue(["https://acme.io/company/moved-home"]);
    await captureCmoBrandMedia("bot-1");
    const saved = files.put.mock.calls.map(([pathname]) => pathname);
    expect(saved.filter((path) => path.includes("/Full pages/"))).toEqual([
      `${ORG}/Full pages/home.jpg`,
      `${ORG}/Full pages/pricing.jpg`,
    ]);
    expect(saved.filter((path) => path.includes("about"))).toEqual([]);
  });

  it("logs a failed background capture without the page's words", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Could not capture the brand's pages for Cuso",
      ["The brand media capture threw"],
    );
    cuso.findForBot.mockRejectedValue(
      new Error("Page SENTINEL-PAGE our founder's story failed"),
    );
    scheduleCmoBrandMedia("bot-1");
    await vi.mocked(waitUntil).mock.calls[0]?.[0];
    expect(warnings[0]?.event).toMatchObject({
      operation: "cmo_brand_media",
      sokoBot: { id: "bot-1" },
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-PAGE");
  });

  it("does not capture again within minutes of the last capture", async () => {
    db.fileProjectLink.findFirst.mockResolvedValue({ id: "link-1" });
    await captureCmoBrandMedia("bot-1");
    expect(files.put).not.toHaveBeenCalled();
  });

  it("does not count the homepage shots hiring took as a recent capture", async () => {
    await captureCmoBrandMedia("bot-1");
    expect(db.fileProjectLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resource: expect.objectContaining({
            NOT: [
              { sourceId: { endsWith: "/Brand research/home.jpg" } },
              { sourceId: { endsWith: "/Brand research/home-mobile.jpg" } },
            ],
          }),
        }),
      }),
    );
  });

  it("captures the homepage on a desktop and a phone at hire, without research", async () => {
    await captureCmoHomepage({
      sokoBotId: "bot-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io/start",
    });
    expect(files.put.mock.calls.map(([pathname]) => pathname).sort()).toEqual([
      `${ORG}/home-mobile.jpg`,
      `${ORG}/home.jpg`,
    ]);
  });
});

describe("the Project's brand research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.fileProjectLink.findMany.mockResolvedValue([
      researchFile("f-home", "home.jpg"),
      researchFile("f-phone", "home-mobile.jpg"),
      researchFile("f-pricing", "pricing.jpg"),
      researchFile("f-pricing-full", "Full pages/pricing.jpg"),
      researchFile("f-plain-part", "Sections/home-02-section-how-it-works.jpg"),
      researchFile(
        "f-plans",
        "Sections/pricing-01-pricing-plans-starter-pro.jpg",
      ),
      researchFile("f-index", "index.json"),
      researchFile("f-rival", "Competitors/rival-co.jpg"),
      researchFile("f-new", "Pictures/01-red-sneaker.jpg"),
      // An earlier capture's first picture: the newer one replaced it.
      researchFile("f-old", "Pictures/01-blue-shoe.jpg"),
      researchFile("f-plain", "Pictures/picture-02.jpg"),
    ]);
    files.list.mockResolvedValue({
      blobs: [
        "home.jpg",
        "home-mobile.jpg",
        "pricing.jpg",
        "Full pages/pricing.jpg",
        "Sections/home-02-section-how-it-works.jpg",
        "Sections/pricing-01-pricing-plans-starter-pro.jpg",
        "index.json",
        "Competitors/rival-co.jpg",
        "Pictures/01-red-sneaker.jpg",
        "Pictures/picture-02.jpg",
      ].map((path) => ({
        pathname: `${ORG}/${path}`,
        url: `https://blob.example/${path}`,
        uploadedAt: new Date("2026-10-27T10:00:00Z"),
      })),
      hasMore: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          pages: [
            { name: "home", url: "https://acme.io/", title: "Acme" },
            { name: "pricing", url: "https://acme.io/plans", title: "Plans" },
          ],
          sections: [
            {
              name: "pricing-01-pricing-plans-starter-pro",
              title: "Plans: Starter & Pro",
              pageUrl: "https://acme.io/plans",
            },
          ],
        }),
      ),
    );
  });

  it("gives Cuso the page screenshots, the sections with the plain ones last, then the pictures", async () => {
    expect(await listCmoBrandPictures("project-1")).toEqual([
      { fileId: "f-home", alt: "Home page screenshot" },
      { fileId: "f-phone", alt: "Home on a phone page screenshot" },
      { fileId: "f-pricing", alt: "Pricing page screenshot" },
      {
        fileId: "f-plans",
        alt: "Pricing cards, Pricing page: plans starter pro",
      },
      { fileId: "f-plain-part", alt: "Section, Home page: how it works" },
      { fileId: "f-new", alt: "red sneaker" },
      { fileId: "f-plain", alt: "" },
    ]);
    expect(db.fileProjectLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          state: "CONFIRMED",
        }),
      }),
    );
  });

  it("shows CMO the pages read, their sections, competitors and pictures from the Project's files", async () => {
    const stamp = new Date("2026-10-27T10:00:00Z").getTime();
    const media = await cmoBrandMedia({
      projectId: "project-1",
      websiteUrl: "https://acme.io",
      brain: brain({
        competitors: [{ name: "Rival Co", url: "https://rival.example/x" }],
      }),
    });
    expect(media).toEqual({
      capturedAt: "2026-10-27T10:00:00.000Z",
      pages: [
        {
          url: `https://blob.example/home.jpg?v=${stamp}`,
          fileId: "f-home",
          label: "Home",
          pageUrl: "https://acme.io/",
          device: "desktop",
          fullUrl: null,
        },
        {
          url: `https://blob.example/home-mobile.jpg?v=${stamp}`,
          fileId: "f-phone",
          label: "Home",
          pageUrl: "https://acme.io/",
          device: "mobile",
          fullUrl: null,
        },
        {
          url: `https://blob.example/pricing.jpg?v=${stamp}`,
          fileId: "f-pricing",
          label: "Pricing",
          // The address the capture read, from its index.
          pageUrl: "https://acme.io/plans",
          device: "desktop",
          fullUrl: `https://blob.example/Full pages/pricing.jpg?v=${stamp}`,
        },
      ],
      sections: [
        {
          url: `https://blob.example/Sections/home-02-section-how-it-works.jpg?v=${stamp}`,
          fileId: "f-plain-part",
          kind: "section",
          title: "how it works",
          pageLabel: "Home",
          pageUrl: "https://acme.io/",
        },
        {
          url: `https://blob.example/Sections/pricing-01-pricing-plans-starter-pro.jpg?v=${stamp}`,
          fileId: "f-plans",
          kind: "pricing",
          title: "Plans: Starter & Pro",
          pageLabel: "Pricing",
          pageUrl: "https://acme.io/plans",
        },
      ],
      competitors: [
        {
          url: `https://blob.example/Competitors/rival-co.jpg?v=${stamp}`,
          fileId: "f-rival",
          name: "Rival Co",
          pageUrl: "https://rival.example/",
        },
      ],
      pictures: [
        {
          url: `https://blob.example/Pictures/01-red-sneaker.jpg?v=${stamp}`,
          fileId: "f-new",
          alt: "red sneaker",
        },
        {
          url: `https://blob.example/Pictures/picture-02.jpg?v=${stamp}`,
          fileId: "f-plain",
          alt: "",
        },
      ],
    });
  });

  it("is null before research saved anything", async () => {
    db.fileProjectLink.findMany.mockResolvedValue([]);
    expect(
      await cmoBrandMedia({
        projectId: "project-1",
        websiteUrl: "https://acme.io",
        brain: null,
      }),
    ).toBeNull();
    expect(files.list).not.toHaveBeenCalled();
  });
});
