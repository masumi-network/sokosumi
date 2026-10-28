import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  connectSokoBotIntegration,
  finalizeSokoBotIntegration,
  integrationFindMany,
  projectFindUnique,
  projectUpdate,
  resetCmoServiceMocks,
} from "@/test-fixtures/cmo-service";

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

vi.mock("@/lib/site-platform", () => ({
  detectSitePlatform: vi.fn(async () => "shopify"),
}));

import {
  connectCmoMeasurement,
  finalizeCmoMeasurement,
  learnCmoSitePlatform,
  listCmoMeasurement,
} from "./cmo-measurement.service";

beforeEach(resetCmoServiceMocks);

describe("measurement", () => {
  const hire = {
    id: "cmo-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
  };

  it("learns the site platform onto the Project, not the hire", async () => {
    await learnCmoSitePlatform({
      projectId: "project-1",
      websiteUrl: "https://acme.io",
    });
    expect(projectUpdate).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { sitePlatform: "shopify" },
    });
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("lists the sources with their connection state", async () => {
    integrationFindMany.mockResolvedValue([
      { provider: "google_analytics", status: "ACTIVE" },
      { provider: "shopify", status: "PENDING" },
    ]);
    const sources = await listCmoMeasurement("bot-1", "shopify");
    expect(sources.map((s) => [s.provider, s.status])).toEqual([
      ["google_analytics", "connected"],
      ["google_search_console", "none"],
      ["shopify", "pending"],
    ]);
  });

  it("offers Shopify only to a Shopify shop", async () => {
    integrationFindMany.mockResolvedValue([]);
    for (const platform of ["other", null]) {
      const sources = await listCmoMeasurement("bot-1", platform);
      expect(sources.map((s) => s.provider)).toEqual([
        "google_analytics",
        "google_search_console",
      ]);
    }
    cmoFindUnique.mockResolvedValue(hire);
    projectFindUnique.mockResolvedValue({ sitePlatform: "other" });
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "shopify",
        returnUrl: "https://app.cmo.xyz/measure/callback",
      }),
    ).rejects.toThrow(/Shopify shops only/);
  });

  it("connects to Cuso's own bot and returns only to CMO", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    projectFindUnique.mockResolvedValue({ sitePlatform: "shopify" });
    connectSokoBotIntegration.mockResolvedValue({ redirectUrl: "https://x" });
    await connectCmoMeasurement({
      userId: "user-1",
      provider: "shopify",
      returnUrl: "https://app.cmo.xyz/measure/callback",
    });
    expect(connectSokoBotIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        provider: "shopify",
        selector: { kind: "id", sokoBotId: "bot-1" },
      }),
    );
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "shopify",
        returnUrl: "https://evil.example/",
      }),
    ).rejects.toThrow(/return address/);
    await expect(
      connectCmoMeasurement({
        userId: "user-1",
        provider: "gmail",
        returnUrl: "https://app.cmo.xyz/measure/callback",
      }),
    ).rejects.toThrow(/does not measure/);
  });

  it("finalizes on Cuso's bot", async () => {
    cmoFindUnique.mockResolvedValue(hire);
    await finalizeCmoMeasurement({
      userId: "user-1",
      provider: "google_analytics",
    });
    expect(finalizeSokoBotIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google_analytics",
        selector: { kind: "id", sokoBotId: "bot-1" },
      }),
    );
  });
});
