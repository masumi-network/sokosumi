import { CMO_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, latest, start } = vi.hoisted(() => ({
  db: {
    sokoBot: { findUnique: vi.fn() },
    sokoBotTurn: { findFirst: vi.fn() },
  },
  latest: vi.fn(),
  start: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("./cmo-seo-audit.service", () => ({ latestCmoSeoAudit: latest }));
vi.mock("./cmo-seo.service", () => ({
  CMO_SEO_ROUTE: { route: "MANAGE_WORK" },
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  cmoRunnerUserId: async () => "owner-1",
  startCmoTurn: start,
}));

import { startCmoSeoReport } from "./cmo-seo-report.service";

const cuso = {
  sokoBotId: "bot-1",
  projectId: "project-1",
  workspaceId: "ws-1",
  businessName: "NMKR",
} as never;
const now = new Date("2026-11-23T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.sokoBot.findUnique.mockResolvedValue({ versionId: "cmo-v12" });
  db.sokoBotTurn.findFirst.mockResolvedValue(null);
  latest.mockResolvedValue({
    id: "audit-1",
    observedAt: new Date("2026-11-23T06:40:00Z"),
  });
});

describe("startCmoSeoReport", () => {
  it("starts one report turn per audit, named by the audit", async () => {
    await startCmoSeoReport(cuso, now);
    expect(start).toHaveBeenCalledWith(
      cuso,
      "owner-1",
      expect.objectContaining({
        clientTurnId: "cmo:seo-report:audit-1",
        message: expect.stringContaining(
          "Weekly SEO report for NMKR: the site audit of 2026-11-23 is in.",
        ),
      }),
    );
    db.sokoBotTurn.findFirst.mockResolvedValue({ id: "turn-1" });
    await startCmoSeoReport(cuso, now);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("leaves Cusos before cmo-v12 and old audits alone", async () => {
    db.sokoBot.findUnique.mockResolvedValue({
      versionId: CMO_SOKO_BOT_VERSION_ID,
    });
    await startCmoSeoReport(cuso, now);
    db.sokoBot.findUnique.mockResolvedValue({ versionId: "cmo-v12" });
    latest.mockResolvedValue({
      id: "audit-0",
      observedAt: new Date("2026-11-16T06:40:00Z"),
    });
    await startCmoSeoReport(cuso, now);
    expect(start).not.toHaveBeenCalled();
  });
});
