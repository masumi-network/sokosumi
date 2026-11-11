import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
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

const { mutate, viewer } = vi.hoisted(() => ({
  mutate: vi.fn(),
  viewer: { userId: "owner" as string | null },
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    // A null viewer is a session the client has not read yet.
    data: viewer.userId
      ? {
          session: { activeOrganizationId: "org" },
          user: { id: viewer.userId },
        }
      : null,
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
  const content = () => (
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
    </QueryClientProvider>
  );
  const view = render(content());
  return { refreshViewer: () => view.rerender(content()) };
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
  viewer.userId = "owner";
});
afterEach(() => {
  // Unmount first: a mounted connection query refetches when its client
  // clears, and without the stub that request goes to the network.
  cleanup();
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
  it("lets the agent refresh only once the session is known, and reads as that viewer", async () => {
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
    mutate.mockResolvedValue({ ok: true, value: null });
    const viewers: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
        viewers.push(
          new Headers(init?.headers).get("x-seo-viewer") ?? "missing",
        );
        return Response.json(workspace);
      }),
    );
    viewer.userId = null;
    const view = renderWorkspace(workspace);
    await act(async () => {});
    expect(mutate).not.toHaveBeenCalled();
    viewer.userId = "owner";
    view.refreshViewer();
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    await waitFor(() => expect(viewers.length).toBeGreaterThan(0));
    // A read without the viewer is refused (409) and would hide the page.
    expect(viewers.every((id) => id === "owner")).toBe(true);
  });

  it("syncs the displayed source's saved property and traffic while generic setup keeps the newest source", async () => {
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
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
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
    // No range and no traffic field: the dialog says what it reads. The saved source keeps its traffic.
    expect(within(dialog).queryByLabelText("Start date")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: "Traffic" }),
    ).toBeNull();
    expect(
      within(dialog).getByTestId("seo-statistics-reads"),
    ).toHaveTextContent("Reads the last 90 days of all website traffic.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await openStatisticsSetup(user);
    const generic = screen.getByRole("dialog");
    expect(
      within(generic).getByRole("combobox", { name: "Source" }),
    ).toHaveTextContent("Search Console");
    // One property: a line, not a field.
    expect(
      await within(generic).findByText("Saved Search property"),
    ).toBeVisible();
    expect(
      within(generic).queryByRole("combobox", { name: "Property" }),
    ).toBeNull();
    expect(
      within(generic).getByTestId("seo-statistics-reads"),
    ).toHaveTextContent("Reads the last 90 days of Google search data.");
    // A change of source in the dialog takes that source's own last sync: its property and its traffic.
    await user.click(within(generic).getByRole("combobox", { name: "Source" }));
    await user.click(screen.getByRole("option", { name: "Google Analytics" }));
    await waitFor(() =>
      expect(
        within(generic).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("Saved Analytics property"),
    );
    expect(
      within(generic).getByTestId("seo-statistics-reads"),
    ).toHaveTextContent("Reads the last 90 days of all website traffic.");
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
    await within(dialog).findByTestId("seo-statistics-reads");
    await user.click(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    );
    expect(mutate).toHaveBeenCalledOnce();
    finish({ ok: true, value: null });
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("chooses the property that names the audit's site among several", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        return Response.json(
          url.pathname.endsWith("statistics/properties")
            ? {
                provider: "ga4",
                status: "available",
                reason: null,
                properties: [
                  { id: "properties/1", name: "Company blog" },
                  { id: "properties/2", name: "example.com website" },
                ],
              }
            : workspace,
        );
      }),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    // Nothing is saved and nothing is clicked: the sync is ready.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("example.com website"),
    );
    expect(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    ).toBeEnabled();
  });

  it("retries a temporary unavailable property result in place", async () => {
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
    expect(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByRole("combobox", { name: "Property" });
    expect(propertyReads).toBe(2);
    expect(mutate).not.toHaveBeenCalled();
  });
});
