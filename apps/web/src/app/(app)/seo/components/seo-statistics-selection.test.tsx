import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { openStatisticsSetup, seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));

const clients: QueryClient[] = [];
function metric(change: Partial<ProjectSeoMetric>): ProjectSeoMetric {
  return {
    id: "ga4-views",
    key: "page_views",
    label: "Page views",
    unit: "count",
    source: "ga4",
    propertyId: "properties/123",
    value: 100,
    from: "2026-09-01",
    to: "2026-09-28",
    timeZone: "UTC",
    channel: "all",
    observedAt: new Date("2026-10-01T10:00:00Z"),
    coverage: "complete",
    points: [],
    notes: [],
    ...change,
  };
}

function renderWorkspace(workspace: ProjectSeoWorkspace) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function properties(provider: string) {
  return {
    provider,
    status: "available",
    reason: null,
    properties:
      provider === "ga4"
        ? [
            { id: "properties/123", name: "Saved Analytics property" },
            { id: "properties/456", name: "Other Analytics property" },
          ]
        : [{ id: "sc-domain:example.com", name: "Saved Search property" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  sessionStorage.clear();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

async function renderWithPendingAgentRefresh() {
  const workspace = seoTestWorkspace();
  workspace.metrics = [
    metric({
      id: "search-clicks",
      key: "clicks",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic",
    }),
  ];
  let finish: (value: { ok: true; value: null }) => void = () => {};
  mutate.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "https://web.test");
      if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
      return Response.json(
        url.pathname.endsWith("statistics/properties")
          ? properties(url.searchParams.get("provider") ?? "ga4")
          : workspace,
      );
    }),
  );
  renderWorkspace(workspace);
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  return { finish: (value: { ok: true; value: null }) => finish(value) };
}

describe("statistics source and property recovery", () => {
  it("syncs the displayed source's saved property and period while generic setup keeps the newest source", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.observations = [
      {
        id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
        kind: "page_check",
        source: "seo_coworker",
        observedAt: new Date("2026-10-01T10:00:00Z"),
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 2, skipped: 0, failed: 0 },
      },
    ];
    workspace.metrics = [
      metric({}),
      metric({
        id: "search-clicks",
        key: "clicks",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        from: "2026-10-01",
        to: "2026-10-28",
        channel: "organic",
        observedAt: new Date("2026-10-29T10:00:00Z"),
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        return Response.json(
          url.pathname.endsWith("statistics/properties")
            ? properties(url.searchParams.get("provider") ?? "ga4")
            : workspace,
        );
      }),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    // Stale Search Console data makes the agent refresh it once on open.
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    expect(mutate.mock.calls[0][0].command).toMatchObject({
      kind: "sync_statistics",
      body: { provider: "search_console", propertyId: "sc-domain:example.com" },
    });
    mutate.mockClear();
    await user.click(screen.getByRole("combobox", { name: "Source" }));
    await user.click(screen.getByRole("option", { name: "Google Analytics" }));
    // Analytics has no one-click sync; its button opens the dialog for the displayed source.
    await user.click(screen.getByRole("button", { name: "Sync statistics" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("combobox", { name: "Source" }),
    ).toHaveTextContent("Google Analytics");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("Saved Analytics property"),
    );
    expect(within(dialog).getByLabelText("Start date")).toHaveValue(
      "2026-09-01",
    );
    expect(within(dialog).getByLabelText("End date")).toHaveValue("2026-09-28");
    expect(
      within(dialog).getByRole("combobox", { name: "Traffic" }),
    ).toHaveTextContent("All website traffic");
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2026-09-02" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await openStatisticsSetup(user);
    const generic = screen.getByRole("dialog");
    expect(
      within(generic).getByRole("combobox", { name: "Source" }),
    ).toHaveTextContent("Search Console");
    expect(within(generic).getByLabelText("Start date")).toHaveValue(
      "2026-10-01",
    );
    expect(within(generic).getByLabelText("End date")).toHaveValue(
      "2026-10-28",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("keeps an open dialog while the agent refreshes stale Search Console data", async () => {
    const user = userEvent.setup();
    const { finish } = await renderWithPendingAgentRefresh();
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    // The user's own dialog is not blocked by the background refresh.
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
    finish({ ok: true, value: null });
    await waitFor(() =>
      expect(
        screen.queryByText("The agent is refreshing Search Console."),
      ).toBeNull(),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("runs the user's sync after the agent refresh, so the user's result is newest", async () => {
    const user = userEvent.setup();
    const { finish } = await renderWithPendingAgentRefresh();
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("combobox", { name: "Property" });
    await user.click(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    );
    expect(mutate).toHaveBeenCalledOnce();
    finish({ ok: true, value: null });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("retries a temporary unavailable property result in place without replacing edited dates", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    let propertyReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.endsWith("statistics/properties")) {
          propertyReads += 1;
          return Response.json(
            propertyReads === 1
              ? {
                  provider: "ga4",
                  status: "unavailable",
                  properties: [],
                  reason: "Temporary native property read failure",
                }
              : properties("ga4"),
          );
        }
        if (url.pathname.includes("/connections/"))
          return Response.json({
            provider: "ga4",
            status: "connected",
            source: "native",
          });
        if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
        return Response.json(workspace);
      }),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Temporary native property read failure");
    fireEvent.change(within(dialog).getByLabelText("Start date"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(within(dialog).getByLabelText("End date"), {
      target: { value: "2026-09-28" },
    });
    expect(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByRole("combobox", { name: "Property" });
    expect(propertyReads).toBe(2);
    expect(within(dialog).getByLabelText("Start date")).toHaveValue(
      "2026-09-01",
    );
    expect(within(dialog).getByLabelText("End date")).toHaveValue("2026-09-28");
    expect(mutate).not.toHaveBeenCalled();
  });
});
