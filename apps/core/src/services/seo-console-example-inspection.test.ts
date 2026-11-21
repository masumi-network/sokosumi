import { beforeEach, describe, expect, it, vi } from "vitest";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { GSC_PROPERTIES_TOOL } from "@/lib/seo/native-statistics";
import { searchConsoleToolDescriptors } from "@/test-fixtures/seo-search-console";
import { connectionVersion } from "./seo-connections.service";
import { inspectConsoleExamples } from "./seo-console-example-inspection";

const boundary = vi.hoisted(() => ({ account: vi.fn(), read: vi.fn() }));
vi.mock("./seo-connections.service", async (original) => ({
  ...(await original<typeof import("./seo-connections.service")>()),
  resolveSeoStatisticsIntegration: boundary.account,
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
const account = {
  composioAccountId: "account",
  entityId: "entity",
  connectionRevision: "1",
};
const propertyId = "https://example.test/news/";
const access = { connectionVersion: connectionVersion(account), propertyId };
const rows = ["a", "b", "c", "d", "b"].map((path) => ({
  key: propertyId + path,
}));
const audited = new Set([rows[3].key]);

beforeEach(() => {
  vi.resetAllMocks();
  boundary.account.mockResolvedValue(account);
  boundary.read.mockImplementation(async (_account, slug, args) => {
    if (slug === GSC_PROPERTIES_TOOL)
      return {
        siteEntry: [{ siteUrl: propertyId, permissionLevel: "siteOwner" }],
      };
    if (slug !== GSC_INSPECT_TOOL)
      throw new Error("Unexpected provider operation");
    if (args.inspection_url === rows[0].key)
      throw new Error("Private upstream diagnostic");
    return {
      inspectionResult: {
        indexStatusResult: {
          verdict:
            args.inspection_url === rows[3].key
              ? "PASS"
              : "VERDICT_UNSPECIFIED",
        },
      },
    };
  });
});

describe("owner-supplied Google URL Inspection examples", () => {
  it("inspects three distinct supplied URLs, prioritizes audited ones and keeps unknown and unavailable separate", async () => {
    const checked = await inspectConsoleExamples(
      actor,
      access,
      rows,
      audited,
      "not_found",
    );
    expect(boundary.account).toHaveBeenCalledWith(actor, "search_console");
    expect(
      boundary.read.mock.calls
        .filter(([, slug]) => slug === GSC_INSPECT_TOOL)
        .map(([integration, , args]) => [integration, args]),
    ).toEqual(
      [rows[3], rows[0], rows[1]].map(({ key }) => [
        account,
        { site_url: propertyId, inspection_url: key },
      ]),
    );
    expect(checked).toEqual([
      {
        key: rows[3].key,
        inspection: {
          status: "observed",
          checkedAt: expect.any(String),
          verdict: "PASS",
        },
      },
      {
        key: rows[0].key,
        inspection: { status: "unavailable", checkedAt: expect.any(String) },
      },
      {
        key: rows[1].key,
        inspection: {
          status: "observed",
          checkedAt: expect.any(String),
          verdict: "VERDICT_UNSPECIFIED",
        },
      },
    ]);
    for (const row of checked)
      expect(new Date(row.inspection.checkedAt).toISOString()).toBe(
        row.inspection.checkedAt,
      );
  });
  it("never sends an unapproved property prefix, changed account, or revoked grant to URL Inspection", async () => {
    await expect(
      inspectConsoleExamples(
        actor,
        access,
        [...rows, { key: "https://example.test/private" }],
        audited,
        "crawled_not_indexed",
      ),
    ).rejects.toThrow(/property/);
    expect(boundary.account).not.toHaveBeenCalled();
    await expect(
      inspectConsoleExamples(
        actor,
        { ...access, connectionVersion: "different" },
        rows,
        audited,
        "discovered_not_indexed",
      ),
    ).rejects.toThrow(/account changed/);
    expect(boundary.read).not.toHaveBeenCalled();
    boundary.read.mockResolvedValueOnce({
      siteEntry: [
        { siteUrl: propertyId, permissionLevel: "siteUnverifiedUser" },
      ],
    });
    await expect(
      inspectConsoleExamples(actor, access, rows, audited, "not_found"),
    ).rejects.toThrow(/property/);
    expect(boundary.read.mock.calls.map(([, slug]) => slug)).toEqual([
      GSC_PROPERTIES_TOOL,
    ]);
  });
  it.each([
    "redirect",
    "alternate_canonical",
    "excluded_noindex",
    "blocked_robots",
  ] as const)(
    "leaves an expected exclusion (%s) uninspected",
    async (reason) => {
      expect(
        await inspectConsoleExamples(actor, access, rows, audited, reason),
      ).toEqual([]);
      expect(boundary.account).not.toHaveBeenCalled();
      expect(boundary.read).not.toHaveBeenCalled();
    },
  );
});
