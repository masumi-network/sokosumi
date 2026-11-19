import { beforeEach, describe, expect, it, vi } from "vitest";

import prisma from "@/lib/db/prisma";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import {
  GSC_PROPERTIES_TOOL,
  GSC_STATS_TOOL,
} from "@/lib/seo/native-statistics";
import { searchConsoleToolDescriptors } from "@/test-fixtures/seo-search-console";
import { propertyChoices } from "./project-seo-statistics.service";
import {
  assertAuditSearchConsoleCurrent,
  checkAuditSearchConsole,
} from "./seo-audit-search-console";
import { resolveSeoStatisticsIntegration } from "./seo-connections.service";

const boundary = vi.hoisted(() => ({
  client: vi.fn(),
  selected: vi.fn(),
  inherited: vi.fn(),
  saved: vi.fn(),
  read: vi.fn(),
  remoteAccount: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findFirst: async () => ({ organizationId: null }) },
    seoConnection: {
      findUnique: boundary.selected,
      updateMany: boundary.update,
    },
    projectSeoObservation: { findFirst: boundary.saved },
    sokoBotIntegration: { findMany: boundary.inherited },
    $executeRaw: async () => 1,
  },
}));
vi.mock("@/clients/composio.client", async (original) => ({
  ...(await original<typeof import("@/clients/composio.client")>()),
  getComposio: boundary.client,
  getComposioConnectedAccount: boundary.remoteAccount,
}));
vi.mock("./composio-integration-tools.service", async (original) => ({
  ...(await original<typeof import("./composio-integration-tools.service")>()),
  listIntegrationTools: async () => searchConsoleToolDescriptors(),
  readIntegrationTool: boundary.read,
}));

const actor = {
  userId: "owner",
  workspaceId: "workspace",
  organizationId: null,
  owner: { kind: "audit" as const, id: "audit" },
};
const native = {
  id: "connection",
  status: "ACTIVE",
  composioAccountId: "private-account",
  entityId: "private-entity",
  authConfigId: "config",
  revision: 1,
};
const url = "https://example.test/posts/a";
const pages = [{ id: "page", url }];
const domain = "sc-domain:example.test";
const prefix = "https://example.test/posts/";
function sites(...entries: string[]) {
  return {
    siteEntry: entries.map((siteUrl) => ({
      siteUrl,
      permissionLevel: "siteFullUser",
    })),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.client.mockReturnValue({});
  boundary.selected.mockResolvedValue(native);
  boundary.saved.mockResolvedValue(null);
  boundary.inherited.mockResolvedValue([]);
  boundary.remoteAccount.mockRejectedValue(new Error("provider offline"));
  boundary.read.mockImplementation(async (_account, slug) => {
    if (slug === GSC_PROPERTIES_TOOL) return sites(domain);
    if (slug === GSC_INSPECT_TOOL)
      return {
        inspectionResult: {
          indexStatusResult: { verdict: "VERDICT_UNSPECIFIED" },
        },
      };
    return { rows: [] };
  });
});

describe("full audit Search Console coverage", () => {
  it.each(["record", "replay"])(
    "refuses to use integration fixture mode %s as proof of Google access",
    async (mode) => {
      vi.stubEnv("SOKO_BOT_INTEGRATION_FIXTURES", mode);
      try {
        await expect(
          checkAuditSearchConsole(actor, pages),
        ).rejects.toMatchObject({
          cause: { kind: "seo_gsc_unavailable" },
        });
        expect(boundary.read).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("stops before dispatch when search statistics work but URL Inspection cannot read the audit page", async () => {
    boundary.read.mockImplementation(async (_account, slug) => {
      if (slug === GSC_PROPERTIES_TOOL) return sites(domain);
      if (slug === GSC_INSPECT_TOOL) throw new Error("private access error");
      return { rows: [] };
    });
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_unavailable" },
      message: expect.not.stringContaining("private access error"),
    });
  });

  it("never offers an unknown or unverified Google permission level as readable", async () => {
    const integration = await resolveSeoStatisticsIntegration(
      actor,
      "search_console",
    );
    if (!integration) throw new Error("Missing fixture connection");
    boundary.read.mockResolvedValue({
      siteEntry: [
        { siteUrl: domain, permissionLevel: "unexpectedPermission" },
        { siteUrl: prefix, permissionLevel: "siteUnverifiedUser" },
      ],
    });
    expect(
      (await propertyChoices(integration, "search_console")).properties,
    ).toEqual([]);
  });

  it("accepts a successful empty page-filtered read for the selected property", async () => {
    boundary.read
      .mockResolvedValueOnce(sites(domain, prefix))
      .mockResolvedValueOnce({ responseAggregationType: "byPage" });
    const proof = await checkAuditSearchConsole(actor, pages, prefix);
    expect(proof).toEqual({
      propertyId: prefix,
      connectionVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(boundary.read).toHaveBeenCalledWith(
      expect.anything(),
      GSC_STATS_TOOL,
      expect.objectContaining({
        site_url: prefix,
        dimensions: [],
        row_limit: 1,
        dimension_filter_groups: [
          {
            groupType: "and",
            filters: [
              {
                dimension: "page",
                operator: "equals",
                expression: url,
              },
            ],
          },
        ],
      }),
    );
    expect(boundary.read).toHaveBeenLastCalledWith(
      expect.anything(),
      GSC_INSPECT_TOOL,
      { site_url: prefix, inspection_url: url },
    );
    await assertAuditSearchConsoleCurrent(actor, proof, prisma);
    boundary.selected.mockResolvedValue({ ...native, revision: 2 });
    await expect(
      assertAuditSearchConsoleCurrent(actor, proof, prisma),
    ).rejects.toMatchObject({
      status: 409,
      cause: { kind: "seo_gsc_unavailable" },
    });
  });

  it.each([
    {
      scope: "ten long URLs on the same property",
      urls: Array.from(
        { length: 10 },
        (_, index) => `${prefix}${index}-${"a".repeat(450)}`,
      ),
    },
    {
      scope: "one 4096-character URL with regex metacharacters",
      urls: [prefix.padEnd(4096, "a.+()")],
    },
  ])(
    "verifies $scope without exceeding Google's page-filter limit",
    async ({ urls }) => {
      const scope = urls.map((url, index) => ({ id: String(index), url }));
      await expect(
        checkAuditSearchConsole(actor, scope, domain),
      ).resolves.toMatchObject({ propertyId: domain });
      expect(boundary.read).toHaveBeenCalledWith(
        expect.anything(),
        GSC_STATS_TOOL,
        expect.objectContaining({
          dimension_filter_groups: [
            {
              groupType: "and",
              filters: [
                { dimension: "page", operator: "equals", expression: urls[0] },
              ],
            },
          ],
          dimensions: [],
          row_limit: 1,
        }),
      );
    },
  );

  it("reports the unavailable connector before offering to connect an account", async () => {
    boundary.client.mockReturnValue(null);
    boundary.selected.mockResolvedValue(null);
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_unavailable" },
    });
    expect(boundary.read).not.toHaveBeenCalled();
  });

  it.each(["explicit", "saved"])(
    "refuses to silently switch a now-unauthorized %s property",
    async (source) => {
      if (source === "saved")
        boundary.saved.mockResolvedValue({ payload: { propertyId: prefix } });
      await expect(
        checkAuditSearchConsole(
          actor,
          pages,
          source === "explicit" ? prefix : undefined,
        ),
      ).rejects.toMatchObject({ cause: { kind: "seo_gsc_property" } });
      expect(boundary.read).toHaveBeenCalledTimes(1);
    },
  );

  it("requires one choice covering every page when the owner has not selected one", async () => {
    boundary.read.mockResolvedValueOnce(sites(domain, prefix));
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_property" },
    });
    await expect(
      checkAuditSearchConsole(actor, [
        ...pages,
        { id: "other", url: "https://other.test/" },
      ]),
    ).rejects.toMatchObject({ cause: { kind: "seo_gsc_property" } });
  });

  it.each([
    ["DISCONNECTED", "seo_gsc_not_connected"],
    ["NEEDS_RECONNECT", "seo_gsc_reconnect"],
  ])("detects %s before reading Google", async (status, kind) => {
    boundary.selected.mockResolvedValue({ ...native, status });
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind },
    });
    expect(boundary.read).not.toHaveBeenCalled();
  });

  it("keeps a failed authorized statistics read separate from an expired connection", async () => {
    boundary.read
      .mockResolvedValueOnce(sites(domain))
      .mockRejectedValueOnce(new Error("private upstream text"));
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_unavailable" },
      message: expect.not.stringContaining("private upstream text"),
    });
    expect(boundary.update).not.toHaveBeenCalled();
    boundary.remoteAccount.mockResolvedValue({
      id: native.composioAccountId,
      connectorUserId: native.entityId,
      toolkitSlug: "google_search_console",
      authConfigId: native.authConfigId,
      status: "EXPIRED",
    });
    boundary.update.mockImplementation(async () => {
      boundary.selected.mockResolvedValue({
        ...native,
        status: "NEEDS_RECONNECT",
      });
      return { count: 1 };
    });
    boundary.read.mockRejectedValueOnce(new Error("private upstream text"));
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_reconnect" },
    });
  });

  it("refuses malformed statistics data without reporting a disconnected account", async () => {
    boundary.read
      .mockResolvedValueOnce(sites(domain))
      .mockResolvedValueOnce({ unsupported: "wrong tool shape" });
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_unavailable" },
    });
  });

  it("asks the user to select a connection when inherited accounts are ambiguous", async () => {
    boundary.selected.mockResolvedValue(null);
    boundary.inherited.mockResolvedValue([{}, {}]);
    await expect(checkAuditSearchConsole(actor, pages)).rejects.toMatchObject({
      cause: { kind: "seo_gsc_reconnect" },
    });
    expect(boundary.read).not.toHaveBeenCalled();
  });
});
