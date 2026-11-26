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
  read.mockResolvedValueOnce({
    critical: 2,
    warning: 3,
    reconnect: 1,
    pricingAttention: 1,
  });
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
  expect(screen.getByText("Audit payments to check: 1")).toBeInTheDocument();
});

it("shows a current provider incident with an account link on its own tab", async () => {
  read.mockResolvedValue({
    total: 0,
    connectionTotal: 1,
    pageSize: 25,
    connections: [
      {
        id: "conn",
        workspaceId: "same-user-second-workspace",
        workspaceOrganizationSlug: "studio/rental",
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
  expect(
    screen
      .getByRole("link", { name: /same-user-second-workspace/ })
      .getAttribute("href"),
  ).toBe("/admin/organizations/studio%2Frental");
  expect(screen.getByText("Google Analytics 4")).toBeInTheDocument();
  expect(screen.getByText("Needs reconnection")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open account" }).getAttribute("href"),
  ).toBe("/admin/users/user%2F1");
  expect(screen.queryByRole("link", { name: "Open source task" })).toBeNull();
});

it("shows a selectable audit and workspace reference when an incident has no Task", async () => {
  read.mockResolvedValue({
    total: 1,
    connectionTotal: 0,
    critical: 1,
    warning: 0,
    info: 0,
    pageSize: 25,
    items: [
      {
        id: "audit-1",
        auditId: "audit-1",
        workspaceId: "workspace-3",
        taskId: null,
        severity: "critical",
        at: new Date(),
        reasons: ["workerFailed"],
      },
    ],
  });
  render(await AdminSeoAlertsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("audit-1").tagName).toBe("CODE");
  expect(screen.getByText("workspace-3").tagName).toBe("CODE");
  expect(screen.queryByRole("link", { name: "Open source task" })).toBeNull();
});

it("links the first metered run to its pending Task and shows only settled provider totals as cost", async () => {
  const pending = {
    id: "new-run",
    taskId: "new/run",
    at: new Date("2026-11-19T00:00:00Z"),
    status: "receiptsPending",
    approvedMaxCredits: null,
    attemptedCredits: null,
    dataBudgetUsd: null,
    chargedCredits: null,
    cost: null,
  };
  read.mockResolvedValue({
    total: 0,
    connectionTotal: 0,
    billingTotal: 2,
    pageSize: 25,
    billing: [
      pending,
      {
        ...pending,
        id: "canceled-run",
        taskId: "canceled",
        status: "abandoned",
        attemptedCredits: 777,
        dataBudgetUsd: 3,
      },
      {
        ...pending,
        id: "done-run",
        taskId: "done",
        status: "settled",
        chargedCredits: 900,
        cost: {
          version: 1,
          gatewayMicroUsd: 1500000,
          directModelMicroUsd: 2200000,
          dataForSeoMicroUsd: 2299986,
          otherApiMicroUsd: 14,
        },
      },
    ],
  });
  render(
    await AdminSeoAlertsPage({
      searchParams: Promise.resolve({ view: "billing" }),
    }),
  );
  expect(screen.getByText("Waiting for cost receipts")).toBeVisible();
  expect(screen.getByRole("link", { name: "Task ID new/run" })).toHaveAttribute(
    "href",
    "/admin/tasks/new%2Frun",
  );
  expect(screen.getByText("Closed with unpaid costs")).toBeVisible();
  expect(screen.getByText("777 credits")).toBeVisible();
  expect(screen.getByText("0 credits")).toBeVisible();
  expect(screen.getByText("$3.00")).toBeVisible();
  expect(screen.getByText("900 credits")).toBeVisible();
  expect(screen.getByText("$6.00")).toBeVisible();
  expect(screen.getByText("$0.000014")).toBeVisible();
  expect(screen.queryByText("Approved maximum")).toBeNull();
});

it("shows a settled run's cost breakdown with unpriced models and the Unattributed gap", async () => {
  read.mockResolvedValue({
    total: 0,
    connectionTotal: 0,
    billingTotal: 1,
    pageSize: 25,
    billing: [
      {
        id: "done-run",
        taskId: "done",
        at: new Date("2026-11-19T00:00:00Z"),
        status: "settled",
        approvedMaxCredits: null,
        attemptedCredits: null,
        dataBudgetUsd: null,
        chargedCredits: 900,
        cost: {
          version: 1,
          gatewayMicroUsd: 1_500_000,
          directModelMicroUsd: 0,
          dataForSeoMicroUsd: 2_000_000,
          otherApiMicroUsd: 0,
        },
        costDetail: {
          version: 1,
          models: [
            {
              model: "openai/gpt-5",
              provider: "openai",
              calls: 4,
              microUsd: 1_500_000,
            },
            { model: "local", provider: null, calls: 1, microUsd: null },
          ],
          dataForSeo: [
            {
              endpoint: "/v3/serp/google/organic/task_post",
              reads: 7,
              microUsd: 1_250_000,
            },
          ],
          steps: [
            {
              step: "keywords",
              modelMicroUsd: 1_500_000,
              dataForSeoMicroUsd: 2_000_000,
              otherApiMicroUsd: 0,
            },
          ],
        },
      },
    ],
  });
  render(
    await AdminSeoAlertsPage({
      searchParams: Promise.resolve({ view: "billing" }),
    }),
  );
  expect(screen.getByText("Cost breakdown")).toBeInTheDocument();
  expect(screen.getByText("Unpriced")).toBeInTheDocument();
  expect(screen.getByText("Unknown")).toBeInTheDocument();
  const dataForSeoRows = screen
    .getByText("/v3/serp/google/organic/task_post")
    .closest("tbody")!
    .querySelectorAll("tr");
  expect([...dataForSeoRows].map((row) => row.textContent)).toEqual([
    "/v3/serp/google/organic/task_post7$1.25",
    "Unattributed$0.75",
  ]);
  expect(screen.getAllByText("Unattributed")).toHaveLength(1);
});
