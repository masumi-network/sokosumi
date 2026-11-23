import { beforeEach, expect, it, vi } from "vitest";

const findMany = vi.fn();
const execution = {
  enabled: true,
  executor: { canSchedule: true, coworkerId: "seo" },
};

vi.mock("@/lib/db/prisma", () => ({ default: { taskSchedule: { findMany } } }));
vi.mock("@/lib/seo/analysis-executor-config", () => ({
  getSeoAnalysisExecution: () => execution,
}));
vi.mock("@/lib/seo/monitor-plan", () => ({
  parseSeoMonitorPlan: () => ({ analysis: { kind: "audit_full" } }),
}));

const { cmoSeoAuditRoutine } = await import("./cmo-seo-audit.service");
type Cuso = Parameters<typeof cmoSeoAuditRoutine>[0];
const cuso = { projectId: "p", websiteUrl: "https://entry.fyi" } as Cuso;
const monday = new Date("2026-11-30T06:00:00Z");

beforeEach(() => {
  findMany.mockReset();
  execution.enabled = true;
});

it("lists the weekly search check with the monitor's next run", async () => {
  findMany.mockResolvedValue([
    { state: "ACTIVE", nextRunAt: monday, description: "seo_monitor: {}" },
  ]);
  expect(await cmoSeoAuditRoutine(cuso, "Europe/Berlin")).toMatchObject({
    key: "cmo-weekly-seo-audit",
    name: "Weekly search check",
    when: "Every Monday morning",
    nextRunAt: monday,
    timezone: "Europe/Berlin",
  });
});

it("shows no next run before the first audit is set up, or while paused", async () => {
  findMany.mockResolvedValue([]);
  expect(
    (await cmoSeoAuditRoutine(cuso, "Europe/Berlin"))?.nextRunAt,
  ).toBeNull();
  findMany.mockResolvedValue([
    { state: "PAUSED", nextRunAt: monday, description: "seo_monitor: {}" },
  ]);
  expect(
    (await cmoSeoAuditRoutine(cuso, "Europe/Berlin"))?.nextRunAt,
  ).toBeNull();
});

it("leaves it out where audits are off or the brand has no site", async () => {
  expect(
    await cmoSeoAuditRoutine({ ...cuso, websiteUrl: "" }, "Europe/Berlin"),
  ).toBeNull();
  execution.enabled = false;
  expect(await cmoSeoAuditRoutine(cuso, "Europe/Berlin")).toBeNull();
});
