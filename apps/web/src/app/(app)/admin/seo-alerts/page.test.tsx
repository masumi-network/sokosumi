import { render, screen } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "@/messages/en.json";
import AdminSeoAlertsPage from "./page";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/admin-seo-alerts.service", () => ({
  readAdminSeoAlerts: read,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages,
      namespace: "App.Admin.SeoAlerts",
    }),
  getFormatter: async () =>
    createFormatter({
      locale: "en",
      timeZone: "UTC",
      formats: createFormats(),
    }),
}));

it("shows aggregate counts, incident time, page impact and an admin-only task link", async () => {
  read.mockResolvedValue({
    total: 1,
    connectionTotal: 0,
    reconnect: 0,
    connections: [],
    importGraceMinutes: 15,
    critical: 0,
    warning: 1,
    info: 0,
    pageSize: 25,
    failurePercent: 25,
    items: [
      {
        id: "audit",
        taskId: "task/one",
        at: new Date("2026-10-01T01:02:03Z"),
        severity: "warning",
        reasons: ["pageFailureRate"],
        failedPages: 1,
        attemptedPages: 3,
      },
    ],
  });
  render(
    await AdminSeoAlertsPage({
      searchParams: Promise.resolve({ period: "all" }),
    }),
  );
  expect(
    screen.getByText("1 of 3 attempted pages failed."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open source task" }).getAttribute("href"),
  ).toBe("/admin/tasks/task%2Fone");
  expect(document.querySelector("time")?.dateTime).toBe(
    "2026-10-01T01:02:03.000Z",
  );
  expect(read).toHaveBeenCalledWith({ period: "all", page: 1 });
});

it("shows counts on the admin hub and distinguishes a failed read from zero alerts", async () => {
  const { SeoAlertSummary } = await import("./seo-alert-summary");
  read.mockResolvedValueOnce({ critical: 2, warning: 3, reconnect: 1 });
  render(await SeoAlertSummary());
  expect(
    screen.getByText("Last 30 days: 2 critical, 3 warnings"),
  ).toBeInTheDocument();
  expect(screen.getByText("Connections to reconnect: 1")).toBeInTheDocument();
  expect(read).toHaveBeenLastCalledWith({
    period: "30",
    page: 1,
    view: "counts",
  });
  read.mockRejectedValueOnce(new Error("unavailable"));
  render(await SeoAlertSummary());
  expect(screen.getByText("Alert counts are unavailable.")).toBeInTheDocument();
});

it("shows a current provider incident with an account link on its own tab", async () => {
  read.mockResolvedValue({
    total: 0,
    connectionTotal: 1,
    pageSize: 25,
    connections: [
      {
        id: "conn",
        userId: "user/1",
        provider: "ga4",
        status: "NEEDS_RECONNECT",
        at: new Date("2026-11-01T09:00:00Z"),
      },
    ],
  });
  render(
    await AdminSeoAlertsPage({
      searchParams: Promise.resolve({ view: "connections" }),
    }),
  );
  expect(screen.getByText("Google Analytics 4")).toBeInTheDocument();
  expect(screen.getByText("Needs reconnection")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open account" }).getAttribute("href"),
  ).toBe("/admin/users/user%2F1");
  expect(screen.queryByRole("link", { name: "Open source task" })).toBeNull();
});
