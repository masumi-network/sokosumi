import type { TaskSchedule } from "@sokosumi/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEO_MONITOR_MARKER } from "@/lib/seo/monitor-plan";
import { approveManualSeoRun } from "./project-seo-monitor.service";

const boundary = vi.hoisted(() => ({
  owner: vi.fn(),
  pages: vi.fn(),
  approval: vi.fn(),
  google: vi.fn(),
}));
vi.mock("./project-seo-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./project-seo-store")>()),
  requireSeoOwner: boundary.owner,
  resolveSeoScope: boundary.pages,
}));
vi.mock("./seo-monitor-search-console", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./seo-monitor-search-console")>()),
  readMonitorSearchConsoleApproval: boundary.approval,
}));
vi.mock("./seo-audit-search-console", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./seo-audit-search-console")>()),
  checkAuditSearchConsole: boundary.google,
}));
const page = {
  id: "22222222-2222-4222-8222-222222222222",
  url: "https://example.test/",
};
const rule = {
  expr: "0 9 * * *",
  timezone: "UTC",
  endsMode: "AFTER",
  targetRunCount: 2,
} as const;
const schedule = {
  ...rule,
  id: "schedule",
  ownerId: "owner",
  creatorUserId: "owner",
  assigneeId: "worker",
  visibility: "PUBLIC",
  projectId: "project",
  workspaceId: "workspace",
  description:
    SEO_MONITOR_MARKER +
    JSON.stringify({
      version: 1,
      scopeVersion: 0,
      requiresApprovalRecord: true,
      rule,
      analysis: {
        kind: "audit_full",
        pageIds: [page.id],
        countryCode: "US",
        languageCode: "en",
        coworkerId: "worker",
        idempotencyKey: "monitor-template",
      },
    }),
} as TaskSchedule;

describe("manual SEO monitor sitemap consent", () => {
  afterEach(() => vi.resetAllMocks());
  it.each([
    [true, "a", "sc-domain:example.test", true],
    [true, "b", "sc-domain:example.test", undefined],
    [true, "a", "https://example.test/", undefined],
    [false, "a", "sc-domain:example.test", undefined],
  ] as const)(
    "binds the approved choice %s to connection %s and property %s",
    async (consent, connection, propertyId, expected) => {
      boundary.owner.mockResolvedValue({ projectId: schedule.projectId });
      boundary.pages.mockResolvedValue({ pages: [page] });
      boundary.approval.mockResolvedValue({
        propertyId: "sc-domain:example.test",
        connectionVersion: "a".repeat(64),
        ...(consent && {
          includeSitemaps: true,
          includePropertyTotals: true,
          includePageDiscovery: true,
        }),
      });
      boundary.google.mockResolvedValue({
        propertyId,
        connectionVersion: connection.repeat(64),
      });
      const result = await approveManualSeoRun(
        schedule,
        { expectedRevision: 1 },
        "interactive",
      );
      expect(
        result && typeof result === "object" && result.access?.includeSitemaps,
      ).toBe(expected);
      expect(
        result &&
          typeof result === "object" &&
          result.access?.includePageDiscovery,
      ).toBe(expected);
      expect(
        result &&
          typeof result === "object" &&
          result.access?.includePropertyTotals,
      ).toBe(expected);
    },
  );
});
