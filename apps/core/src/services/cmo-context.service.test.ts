import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  connectionFindMany,
  fileLinkFindMany,
  messageFindMany,
  postFindMany,
  projectFindUnique,
  resetCmoServiceMocks,
  strategy,
  subscriptionFindFirst,
} from "@/test-fixtures/cmo-service";

const readDesignMd = vi.hoisted(() => vi.fn());
vi.mock("@/lib/design-md-blob", () => ({
  readDesignMdContent: readDesignMd,
  uploadDesignMdContent: vi.fn(),
}));

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  fitCmoMarketingContext,
  loadCmoMarketingContext,
} from "./cmo-context.service";

beforeEach(resetCmoServiceMocks);

describe("loadCmoMarketingContext", () => {
  it("gives Cuso the Project's logo, DESIGN.md and Brand research pictures", async () => {
    const { loadCmoMarketingContext } = await import("./cmo-context.service");
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      projectId: "project-1",
      brandBrain: null,
      strategy: null,
      strategyApprovedAt: null,
      mockPlan: null,
      updates: [],
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    projectFindUnique.mockResolvedValue({
      logo: "https://blob.example/logo.png",
      designMdUrl: "https://blob.example/DESIGN.md",
    });
    readDesignMd.mockResolvedValue('---\nname: Acme\n---\nPrimary: "#ff6a00"');
    const research = "drive/organizations/org-1/Brand research";
    fileLinkFindMany.mockResolvedValue([
      {
        resource: {
          id: "f-shoe",
          sourceId: `${research}/Pictures/01-red-shoe.jpg`,
        },
      },
      { resource: { id: "f-home", sourceId: `${research}/home.jpg` } },
    ]);

    const context = await loadCmoMarketingContext("bot-1");

    expect(context).toMatchObject({
      brandLook: {
        logoUrl: "https://blob.example/logo.png",
        designMd: '---\nname: Acme\n---\nPrimary: "#ff6a00"',
      },
      brandPictures: [{ fileId: "f-shoe", alt: "red shoe" }],
    });
    expect(context).not.toHaveProperty("brandVisual");
    expect(projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1" } }),
    );
  });
});

describe("buildCmoBeatPacket", () => {
  it("stays well under the message limit with a long plan", async () => {
    const { buildCmoBeatPacket } = await import("./cmo-context.service");
    const long = "x".repeat(2_000);
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More leads",
      brandBrain: { summary: long },
      strategy: {
        ...strategy,
        calendar: Array.from({ length: 30 }, (_, index) => ({
          ...strategy.calendar[0],
          id: `e${index}`,
          title: long,
        })),
      },
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyApprovedAt: new Date("2026-10-01T09:00:00Z"),
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    postFindMany.mockResolvedValue([]);
    const { packet, skip } = await buildCmoBeatPacket(
      "bot-1",
      new Date("2026-10-06T07:00:00Z"),
      "cmo-daily-run",
    );
    expect(skip).toBe(false);
    expect(packet).toContain("workspace.marketing");
    expect(packet.length).toBeLessThan(5_000);
  });
});

describe("loadCmoMarketingContext", () => {
  it("gives Cuso his latest reports from the cards in his room", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      strategy: null,
      strategyApprovedAt: null,
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    messageFindMany.mockResolvedValue([
      {
        id: "message-1",
        createdAt: new Date("2026-10-05T09:03:00Z"),
        metadata: {
          cmo_report: {
            kind: "weekly",
            headline: "Week 1",
            done: [],
            upNext: [],
            changes: [],
            previousStrategy: strategy,
          },
        },
      },
    ]);
    const context = await loadCmoMarketingContext("bot-1");
    expect(messageFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { senderSokoBotId: "bot-1" },
      take: 3,
    });
    expect(context?.recentUpdates).toEqual([
      expect.objectContaining({ id: "message-1", headline: "Week 1" }),
    ]);
    expect(JSON.stringify(context)).not.toContain("previousStrategy");
  });
});

describe("fitCmoMarketingContext", () => {
  const now = new Date("2026-11-01T09:00:00Z");
  const entry = (id: string, date: string) => ({
    id,
    date,
    channel: "instagram",
    format: "image",
    title: `Piece ${id}`,
    status: "draft",
    draft: "x".repeat(600),
    brief: "y".repeat(200),
  });
  const context = {
    brandBrain: { summary: "A shop", profile: {} },
    strategy: {
      summary: "Plan",
      weeks: ["w".repeat(2_000)],
      calendar: [entry("soon", "2026-11-02"), entry("later", "2026-11-20")],
    },
  };

  it("leaves a context that fits alone", () => {
    expect(fitCmoMarketingContext(context, now, 100_000)).toBe(context);
  });

  it("sheds later drafts first, then secondary plan parts, keeping the next days whole", () => {
    const fitted = fitCmoMarketingContext(context, now, 2_000) as {
      strategy: {
        calendar: Record<string, unknown>[];
        storedNotShown?: string[];
      };
    };
    const [soon, later] = fitted.strategy.calendar;
    expect(soon?.draft).toBeDefined();
    expect(later?.draft).toBeUndefined();
    expect(later?.detailsStored).toBe(true);
    expect(fitted.strategy.storedNotShown).toContain("weeks");
  });
});
