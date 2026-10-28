import type { CmoBrandBrain } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/site-capture", () => ({
  MOBILE: { width: 390, height: 844 },
  withBrowser: (work: (browser: unknown) => unknown) => work({}),
  capturePage: async (_browser: unknown, url: string) => ({
    url,
    title: "Acme",
    screenshot: Buffer.from("shot"),
    images: url.startsWith("https://acme.io")
      ? [
          {
            url: "https://acme.io/sneaker.jpg",
            width: 1200,
            height: 900,
            alt: "Red sneaker on white",
          },
        ]
      : [],
  }),
}));

import {
  captureCmoBrandMedia,
  cmoBrandMedia,
  cmoCompetitorPages,
  cmoOwnPages,
  listCmoBrandPictures,
} from "./cmo-brand-media.service";

const finding = (sourceUrl: string) => ({
  point: "A finding.",
  evidence: "fact" as const,
  confidence: "high" as const,
  sourceUrl,
});

function brain(extra: Partial<CmoBrandBrain>): CmoBrandBrain {
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
  });

  it("saves screenshots and pictures as the Project's files under Brand research", async () => {
    await captureCmoBrandMedia("bot-1");

    expect(files.put.mock.calls.map(([pathname]) => pathname)).toEqual(
      expect.arrayContaining([
        `${ORG}/home.jpg`,
        `${ORG}/home-mobile.jpg`,
        `${ORG}/Competitors/rival-co.jpg`,
        `${ORG}/Pictures/01-red-sneaker-on-white.jpg`,
      ]),
    );
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

  it("does not capture again within minutes of the last capture", async () => {
    db.fileProjectLink.findFirst.mockResolvedValue({ id: "link-1" });
    await captureCmoBrandMedia("bot-1");
    expect(files.put).not.toHaveBeenCalled();
  });
});

describe("the Project's brand research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.fileProjectLink.findMany.mockResolvedValue([
      researchFile("f-home", "home.jpg"),
      researchFile("f-phone", "home-mobile.jpg"),
      researchFile("f-pricing", "pricing.jpg"),
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
  });

  it("gives Cuso the pictures as file references, newest per slot", async () => {
    expect(await listCmoBrandPictures("project-1")).toEqual([
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

  it("shows CMO the pages, competitors and pictures from the Project's files", async () => {
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
        },
        {
          url: `https://blob.example/home-mobile.jpg?v=${stamp}`,
          fileId: "f-phone",
          label: "Home on a phone",
          pageUrl: "https://acme.io/",
          device: "mobile",
        },
        {
          url: `https://blob.example/pricing.jpg?v=${stamp}`,
          fileId: "f-pricing",
          label: "Pricing",
          pageUrl: "https://acme.io/pricing",
          device: "desktop",
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
