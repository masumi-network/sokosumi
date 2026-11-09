import type {
  ProjectSeoWorkspace,
  SeoAuditChatHistory,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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
import { SEO_VIEWER_HEADER } from "@/lib/seo/owner";
import messages from "../../../../../messages/en.json";
import { SeoMonitors } from "./seo-monitors";
import {
  openStatisticsSetup,
  SEO_TEST_AUDIT,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, viewer, ensureRoom, push } = vi.hoisted(() => ({
  mutate: vi.fn(),
  viewer: { userId: "owner" as string | null },
  ensureRoom: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: ensureRoom,
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push }),
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
function nativeChatNetwork(
  workspace: ProjectSeoWorkspace,
  options: { uncertainFirst?: boolean; failedFirst?: boolean } = {},
) {
  const requests: Array<{
    question: string;
    idempotencyKey: string;
    scope: Record<string, unknown>;
  }> = [];
  const turns: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith("/chat")) return Response.json(workspace);
      if (init?.method !== "POST") return Response.json({ turns });
      if (typeof init.body !== "string")
        throw new Error("Missing JSON question");
      const body = JSON.parse(init.body);
      requests.push(body);
      if (options.uncertainFirst && requests.length === 1)
        throw new Error("Uncertain response");
      const turn = {
        id: crypto.randomUUID(),
        question: body.question,
        status:
          options.failedFirst && requests.length === 1 ? "failed" : "completed",
        response: "The selected page needs a clearer title.",
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      };
      turns.push(turn);
      return Response.json(turn);
    }),
  );
  return requests;
}

function SeoMonitorPanel({ workspace }: { workspace: ProjectSeoWorkspace }) {
  return <SeoMonitors model={useSeoWorkspace(workspace)} />;
}
function renderWorkspace(
  workspace: ProjectSeoWorkspace,
  searchParams = "",
  monitorsOnly = false,
  staleTime = 0,
) {
  const View = monitorsOnly ? SeoMonitorPanel : SeoWorkspace;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
  clients.push(client);
  const content = (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          <View workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(content);
  return {
    ...view,
    client,
    refreshViewer: () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            formats={createFormats()}
            messages={messages}
          >
            <NuqsTestingAdapter searchParams={searchParams} hasMemory>
              <View workspace={workspace} />
            </NuqsTestingAdapter>
          </NextIntlClientProvider>
        </QueryClientProvider>,
      ),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  viewer.userId = "owner";
});
afterEach(() => {
  sessionStorage.clear();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("SEO workspace integration", () => {
  it.each([
    [
      "a newer check that measured nothing",
      "page_check",
      "These checks are incomplete",
    ],
    ["a newer rankings read", "rankings", "No issues found in the last check"],
  ] as const)(
    "judges the verdict by the newest rule check after %s",
    (_, kind, verdict) => {
      const workspace = seoTestWorkspace();
      const base = {
        source: "seo_coworker",
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop" as const],
        rulebookVersion: "html-v1",
      };
      workspace.observations = [
        {
          ...base,
          id: "8b0f8f0e-31d5-4d1e-9a52-5d7c1c3a1f10",
          kind,
          observedAt: new Date("2026-01-03T12:00:00Z"),
          artifactHash: "newer",
          issues: 0,
          coverage: {
            checked: 0,
            skipped: kind === "page_check" ? 30 : 0,
            failed: 0,
          },
        },
        {
          ...base,
          id: "1d0e0b6a-0c43-4c55-9d2f-6a6f2f1b7b11",
          kind: "page_check",
          observedAt: new Date("2026-01-01T12:00:00Z"),
          artifactHash: "older",
          issues: 0,
          coverage: { checked: 20, skipped: 0, failed: 0 },
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
        verdict,
      );
    },
  );

  it("keeps passing measurements behind closed check details and offers statistics after limited checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.observations.push({
      id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    });
    workspace.findings.push({
      id: "measured-title",
      observationId: workspace.observations[0].id,
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Title length measured",
      severity: "measure",
      evidence: [
        "The title has 42 characters. Technical reference: HTML title element.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/statistics/properties")
            ? { status: "not_connected", properties: [] }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    const measurement = screen.getByText("Title length measured");
    expect(measurement).not.toBeVisible();
    expect(measurement.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
    expect(screen.getByText(/tests? on 1 page\./)).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Set up statistics" })[0],
    );
    expect(
      screen.getByRole("dialog", { name: "Sync statistics" }),
    ).toBeVisible();
  });

  it("keeps raw issue evidence out of the default findings cards", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.findings.push({
      id: "missing-description",
      observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "meta-description",
      title: "The page has no description",
      severity: "major",
      evidence: ["Raw HTML evidence: no meta description element."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.getByText("The page has no description")).toBeVisible();
    const evidence = screen.getByText(
      "Raw HTML evidence: no meta description element.",
    );
    expect(evidence).not.toBeVisible();
    await user.click(screen.getByText("Check details"));
    expect(evidence).toBeVisible();
  });

  it("leaves the date filter off the Competitors tab unless dates are set", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace, "?tab=competitors");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    unmount();
    // A set date filter still shows, so it can be cleared.
    renderWorkspace(workspace, "?tab=competitors&from=2026-01-01");
    expect(screen.getByLabelText("Activity from")).toBeVisible();
  });

  it("folds empty date fields opened on another tab when Competitors opens", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Competitors" }));
    expect(screen.queryByLabelText("Activity from")).toBeNull();
  });

  it("keeps a Competitors date field while its date is cleared mid-edit", async () => {
    const workspace = seoTestWorkspace();
    // No other filter: the date fields alone keep the filter block.
    workspace.availableActions.canEdit = false;
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=competitors&from=2026-01-01");
    const from = screen.getByLabelText("Activity from");
    // A date input reports an empty value as soon as one part is cleared.
    fireEvent.change(from, { target: { value: "" } });
    await waitFor(() => expect(from).toHaveValue(""));
    expect(screen.getByLabelText("Activity from")).toBe(from);
  });

  it("puts the filters under the tabs so the tab row stays put", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const tabs = screen.getByRole("tablist");
    const dates = screen.getByRole("button", { name: "Filter by date" });
    expect(
      tabs.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leaves the Primary page badge off a lone page", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=pages");
    expect(screen.getByText("https://example.com/")).toBeVisible();
    expect(screen.queryByText("Primary page")).toBeNull();
  });

  it("hides the page picker when the only page is the one selected", () => {
    const workspace = seoTestWorkspace();
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(
      workspace,
      `?pageId=${workspace.pages[0].id}`,
    );
    // One page is all pages; the picker would only repeat it.
    expect(screen.queryByRole("combobox", { name: "Pages" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Pages and filters/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    unmount();
    // A page the Audit no longer has stays visible, so the filter can be cleared.
    renderWorkspace(workspace, "?pageId=removed-page");
    expect(screen.getByRole("combobox", { name: "Pages" })).toBeVisible();
  });

  it.each([true, false])(
    "lists a check under Check details only when it has no Timeline row: %s",
    (onTimeline) => {
      const workspace = seoTestWorkspace();
      workspace.findings = [];
      workspace.observations = [
        {
          id: "lone-check",
          kind: "page_check",
          source: "seo_coworker",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          pageIds: workspace.scope.pageIds,
          scopeVersion: 2,
          sourceTaskId: null,
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          rulebookVersion: "html-v1",
          artifactHash: "lone",
          issues: 0,
          coverage: { checked: 2, skipped: 1, failed: 0 },
        },
      ];
      workspace.timeline = onTimeline
        ? [
            {
              id: "lone-event",
              kind: "check",
              title: "SEO check results imported",
              status: "completed",
              detail: "",
              at: new Date("2026-01-03T12:00:00Z"),
              pageIds: workspace.scope.pageIds,
              taskId: null,
              observationId: "lone-check",
            },
          ]
        : [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      // The Timeline row carries the coverage; a second list would repeat it.
      expect(
        screen.queryByRole("heading", {
          name: "Page measurements and notes",
        }) !== null,
      ).toBe(!onTimeline);
      expect(
        screen.getByText(
          onTimeline
            ? /^2 tests · .* · 1 not checked$/
            : "Rule checks: 2 checked, 1 not checked, 0 unavailable",
        ),
      ).toBeInTheDocument();
    },
  );

  it.each([false, true])(
    "distinguishes an empty Actions tab when checked evidence exists: %s",
    async (checked) => {
      const workspace = seoTestWorkspace();
      if (checked)
        workspace.observations.push({
          id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
          kind: "page_check",
          source: "seo_coworker",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          pageIds: workspace.scope.pageIds,
          scopeVersion: 2,
          sourceTaskId: null,
          countryCode: "US",
          languageCode: "en",
          devices: ["desktop"],
          rulebookVersion: "html-v1",
          artifactHash: "checked-html",
          issues: 0,
          coverage: { checked: 2, skipped: 2, failed: 0 },
        });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=actions");
      expect(
        screen.getByText(
          checked
            ? "No fixes recommended from these checks"
            : "No recommended actions",
        ),
      ).toBeVisible();
      expect(screen.queryByText("These checks are incomplete")).toBeNull();
    },
  );

  it.each([
    { label: "", expected: "Related to: https://example.com/" },
    { label: "Home", expected: "Related to: Home" },
  ])(
    "shows the related page's parent when its label is '$label'",
    async ({ label, expected }) => {
      const workspace = seoTestWorkspace();
      workspace.pages[0].label = label;
      workspace.pages.push({
        ...workspace.pages[0],
        id: crypto.randomUUID(),
        url: "https://example.com/blogs",
        label: "Blog",
        relationship: "related",
        relatedToPageId: workspace.pages[0].id,
      });
      workspace.scope.pageIds = workspace.pages.map((page) => page.id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=pages");
      const row = screen.getByRole("heading", { name: "Blog" }).closest("li");
      if (!row) throw new Error("Related page row missing");
      expect(within(row).getByText(expected)).toBeVisible();
    },
  );

  it("shows search totals on a page only while the saved statistics cover that page alone", () => {
    const workspace = seoTestWorkspace();
    const clicks = {
      id: "sync:clicks",
      key: "clicks",
      label: "Clicks",
      unit: "count" as const,
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      value: 7,
      from: "2026-01-01",
      to: "2026-01-28",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      points: [],
      notes: [],
    };
    workspace.metrics = [
      clicks,
      { ...clicks, id: "sync:ctr", key: "ctr", unit: "ratio", value: 0.057 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace, "tab=pages");
    const row = screen.getByRole("heading", { name: "Home" }).closest("li");
    if (!row) throw new Error("Page row missing");
    expect(within(row).getByText("Search clicks")).toBeVisible();
    expect(within(row).getByText("7")).toBeVisible();
    // The same rate the Performance tiles show, as a percent.
    expect(within(row).getByText("5.7%")).toBeVisible();
    expect(within(row).getByText("Not checked yet")).toBeVisible();
    // One page has nothing to switch to.
    expect(within(row).queryByRole("button", { name: "View page" })).toBeNull();
    unmount();

    const two = seoTestWorkspace();
    two.metrics = [clicks];
    two.pages.push({ ...two.pages[0], id: crypto.randomUUID(), label: "Blog" });
    two.scope.pageIds = two.pages.map((page) => page.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(two)),
    );
    renderWorkspace(two, "tab=pages");
    // Totals for two pages belong to neither page.
    expect(screen.queryByText("Search clicks")).toBeNull();
  });

  it("opens the chat with a comparison question for a competitor and sends nothing", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      competitors: [
        {
          id: "rival",
          url: "https://rival.example/",
          role: "competitor" as const,
          confirmed: true,
          source: "saved",
          rank: null,
          backlinks: null,
          referringDomains: null,
          observedAt: null,
          observationId: null,
          version: 1,
          canConfirm: true,
          exclusionReason: null,
        },
      ],
    };
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(
        url.endsWith("/chat") ? { sharing: "personal", turns: [] } : workspace,
      ),
    );
    vi.stubGlobal("fetch", fetch);
    renderWorkspace(workspace, "tab=competitors");
    await user.click(
      screen.getByRole("button", { name: "Compare with my page" }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "Compare my page with https://rival.example/. What does it do better for the same searches, and what should I change first?",
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });

  it("labels a saved page group's navigation as a selection", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.scopes[0].name = "Website and blog";
    // Saved selections show only once there is more than one page to choose from.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: `${workspace.pages[0].url}blog`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "tab=pages");
    const row = screen
      .getByRole("heading", { name: "Website and blog" })
      .closest("li");
    if (!row) throw new Error("Saved page selection missing");
    expect(within(row).queryByRole("button", { name: "View page" })).toBeNull();
    await user.click(
      within(row).getByRole("button", { name: "View selection" }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`scopeId=${workspace.scopes[0].id}`),
        expect.any(Object),
      ),
    );
  });

  it("points the position arrow up when the position improves", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from({ length: 14 }, (_, day) =>
      new Date(Date.UTC(2026, 9, day + 1)).toISOString().slice(0, 10),
    );
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: days[0],
      to: days[13],
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    workspace.metrics = [
      {
        ...base,
        id: "sync:impressions",
        key: "impressions",
        unit: "count",
        value: 280,
        // 140 impressions a week: enough to judge a position change.
        points: days.map((date) => ({ date, value: 20 })),
      },
      {
        ...base,
        id: "sync:position",
        key: "position",
        unit: "position",
        value: 4.5,
        // Position falls from 5 to 4: that is better.
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // An arrow up beside a falling number reads as worse; the words carry it.
    const change = screen.getByText(/: 4\.0 · week before: 5\.0, better$/);
    expect(change.querySelector("svg")).toBeNull();
    // The line names the newest 7 days, so "week before" has a clear anchor.
    expect(change).toHaveTextContent(/^Oct 8\W+14:/);
    expect(screen.getByText(/: 140 · week before: 140$/)).toBeVisible();
    // An average says how many impressions it rests on.
    expect(screen.getByText("From 280 impressions")).toBeVisible();
  });

  it("puts the Google search totals under the agent verdict only when both counts exist", () => {
    const workspace = seoTestWorkspace();
    const base = {
      label: "",
      unit: "count" as const,
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    const impressions = {
      ...base,
      id: "sync:impressions",
      key: "impressions",
      value: 35,
      // Jan 1 was quiet: Google leaves the day out, but the read still covers it.
      points: [{ date: "2026-01-02", value: 35 }],
    };
    workspace.metrics = [
      impressions,
      {
        ...base,
        id: "sync:clicks",
        key: "clicks",
        value: 2,
        points: [{ date: "2026-01-02", value: 2 }],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace);
    expect(screen.getByTestId("seo-agent-traffic")).toHaveTextContent(
      /^Google search: shown 35 times, 2 clicks · Jan 1\W+2, 2026$/,
    );
    unmount();
    // Without clicks the line would read as zero clicks; it stays away.
    workspace.metrics = [impressions];
    renderWorkspace(workspace);
    expect(screen.queryByTestId("seo-agent-traffic")).toBeNull();
  });

  it("does not judge a position change on a handful of impressions", async () => {
    const workspace = seoTestWorkspace();
    const days = Array.from(
      { length: 14 },
      (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
    );
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: days[0],
      to: days[13],
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
    };
    workspace.metrics = [
      {
        ...base,
        id: "sync:impressions",
        key: "impressions",
        unit: "count",
        value: 21,
        // 7 impressions, then 14: a doubling on numbers this small is noise.
        points: days.map((date, day) => ({ date, value: day < 7 ? 1 : 2 })),
      },
      {
        ...base,
        id: "sync:position",
        key: "position",
        unit: "position",
        value: 4.5,
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // One note under the tiles, not one per tile.
    expect(screen.queryByText("Not enough days to compare")).toBeNull();
    // Search Console is Google search only; the subtitle does not repeat it.
    expect(screen.queryByText(/Organic search/)).toBeNull();
    expect(
      screen.getAllByText(/^Too few impressions to compare weeks/),
    ).toHaveLength(1);
    expect(
      screen.getByText(
        // Only the position tile is on show, so the note names only it.
        "Too few impressions to compare weeks for average position.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/better|worse/)).toBeNull();
    // A count is a fact at any size; it keeps its numbers.
    const count = screen.getByText(/: 14 · week before: 7$/);
    expect(count).toBeVisible();
    // The numbers stay; an arrow would read as a trend.
    expect(count.querySelector("svg")).toBeNull();
  });

  it("keeps the arrow on a search count that collapses from a busy week", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from(
      { length: 14 },
      (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
    );
    workspace.metrics = [
      {
        id: "sync:impressions",
        key: "impressions",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt: new Date(),
        coverage: "complete",
        notes: [],
        value: 4935,
        // 4,900 impressions, then 35: a page that dropped out of the results.
        points: days.map((date, day) => ({ date, value: day < 7 ? 700 : 5 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const count = screen.getByText(/: 35 · week before: 4,900$/);
    expect(count.querySelector("svg")).not.toBeNull();
  });

  it("renders source measurements without replacing missing values with zero", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "partial";
    const metric = {
      id: "views",
      key: "page_views",
      label: "Page views",
      unit: "count" as const,
      source: "ga4",
      propertyId: "properties/123",
      channel: "all" as const,
      value: 0,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "Europe/Berlin",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete" as const,
      points: [],
      notes: [],
    };
    workspace.metrics.push(metric, {
      ...metric,
      id: "users",
      key: "active_users",
      label: "Active users",
      value: null,
      coverage: "unavailable",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.getByText("Page views")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Active users")).toBeVisible();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    await user.click(screen.getByText("About this data"));
    expect(screen.getByText(/Europe\/Berlin/)).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  it("keeps percentage totals and daily trend values in the same units", () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "engagement",
      key: "engagement_rate",
      label: "Engagement rate",
      unit: "ratio",
      source: "ga4",
      propertyId: "properties/123",
      channel: "all",
      value: 0.25,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [{ date: "2026-01-01", value: 0.25 }],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.getByTestId("seo-metric-engagement_rate")).toHaveTextContent(
      "25%",
    );
    expect(screen.getByRole("row", { name: "Jan 1 25%" })).toBeInTheDocument();
    const trend = screen.getByRole("group", { name: "Engagement rate" });
    act(() => trend.focus());
    expect(within(trend).getByRole("status")).toHaveTextContent("Jan 1 · 25%");
  });

  it("reopens statistics with the saved source and property instead of restarting setup", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "saved-clicks",
      key: "clicks",
      label: "Search clicks",
      unit: "count",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic",
      value: 41,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (String(input).includes("statistics/properties"))
          return Response.json({
            provider: "search_console",
            status: "available",
            reason: null,
            properties: [
              { id: "sc-domain:other.example", name: "Other website" },
              { id: "sc-domain:example.com", name: "Example website" },
            ],
          });
        return Response.json(workspace);
      }),
    );
    renderWorkspace(workspace);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await openStatisticsSetup(user);
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("combobox", { name: "Source" }),
      ).toHaveTextContent("Search Console");
      await waitFor(() =>
        expect(
          within(dialog).getByRole("combobox", { name: "Property" }),
        ).toHaveTextContent("Example website"),
      );
      expect(within(dialog).getByLabelText("Start date")).toHaveValue(
        "2026-01-01",
      );
      expect(within(dialog).getByLabelText("End date")).toHaveValue(
        "2026-01-02",
      );
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    }
  });

  it.each([
    { query: "", from: "", to: "" },
    {
      query: "from=2026-11-01&to=2026-11-05",
      from: "2026-11-01",
      to: "2026-11-05",
    },
  ])(
    "keeps Audit activity dates ($from / $to) when syncing a different Google reporting period",
    async ({ query, from, to }) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (String(url).includes("statistics/properties"))
            return Response.json({
              provider: "ga4",
              status: "available",
              reason: null,
              properties: [{ id: "properties/123", name: "Example website" }],
            });
          return Response.json(workspace);
        }),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace, query);
      await openStatisticsSetup(user);
      const dialog = screen.getByRole("dialog");
      await waitFor(() =>
        expect(
          within(dialog).getByRole("combobox", { name: "Property" }),
        ).toHaveTextContent("Example website"),
      );
      fireEvent.change(within(dialog).getByLabelText("Start date"), {
        target: { value: "2026-10-01" },
      });
      fireEvent.change(within(dialog).getByLabelText("End date"), {
        target: { value: "2026-10-31" },
      });
      await user.click(
        within(dialog).getByRole("button", { name: "Sync statistics" }),
      );
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining("channel=all"),
          expect.anything(),
        ),
      );
      if (from) {
        expect(screen.getByLabelText(messages.App.Seo.dateFrom)).toHaveValue(
          from,
        );
        expect(screen.getByLabelText(messages.App.Seo.dateTo)).toHaveValue(to);
      } else {
        // Unset activity dates stay folded and unset.
        expect(screen.queryByLabelText(messages.App.Seo.dateFrom)).toBeNull();
        expect(
          screen.getByRole("button", { name: messages.App.Seo.filterDates }),
        ).toBeInTheDocument();
      }
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            kind: "sync_statistics",
            body: expect.objectContaining({
              provider: "ga4",
              propertyId: "properties/123",
              from: "2026-10-01",
              to: "2026-10-31",
            }),
          },
        }),
      );
    },
  );

  it("hides the previous page's evidence while a newly selected page loads", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const secondPage = {
      ...workspace.pages[0],
      id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
      url: "https://example.com/other",
      label: "Other page",
    };
    workspace.pages.push(secondPage);
    workspace.findings.push({
      id: "finding",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      device: "mobile",
      rowId: "row",
      title: "Previous page finding",
      severity: "major",
      evidence: ["Observed title"],
      sourceRef: "task",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.includes(`pageId=${secondPage.id}`)
          ? new Promise(() => {})
          : Promise.resolve(Response.json(workspace)),
      ),
    );
    renderWorkspace(workspace);
    expect(screen.getByText("Previous page finding")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    await user.click(screen.getByRole("option", { name: "Other page" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Previous page finding"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Loading SEO results")).toBeVisible();
  });

  it("does not seed the next viewer's cache with the previous viewer's private metrics", async () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics.push({
      id: "private",
      key: "page_views",
      label: "Page views",
      unit: "count",
      source: "ga4",
      propertyId: "properties/123",
      channel: "all",
      value: 47,
      from: "2026-01-01",
      to: "2026-01-02",
      timeZone: "UTC",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      coverage: "complete",
      points: [],
      notes: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const view = renderWorkspace(workspace);
    expect(screen.getByText("47")).toBeVisible();
    viewer.userId = "another-owner";
    view.refreshViewer();
    expect(screen.queryByText("47")).not.toBeInTheDocument();
    expect(screen.getByText("Loading SEO results")).toBeVisible();
  });

  it("keeps the edited group version frozen when a background read finds another editor's changes", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", status: 409 },
    });
    const view = renderWorkspace(workspace, `?scopeId=${workspace.scope.id}`);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(
      screen.getByRole("button", { name: "Edit page selection" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Selection name"));
    await user.type(
      within(dialog).getByLabelText("Selection name"),
      "My group edit",
    );
    const updated = {
      ...workspace,
      scope: { ...workspace.scope, version: 3 },
      scopes: workspace.scopes.map((scope) => ({ ...scope, version: 3 })),
    };
    await act(async () => {
      view.client.setQueryData(
        [
          "seo-workspace",
          "org",
          "owner",
          "project",
          workspace.projectId,
          `scopeId=${workspace.scope.id}`,
        ],
        updated,
      );
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "update_scope",
        scopeId: workspace.scope.id,
        body: {
          name: "My group edit",
          pageIds: workspace.scope.pageIds,
          expectedVersion: 2,
        },
      },
    });
  });

  it("starts a native HTML check without a prior import or caller-selected executor", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: /coworker/i }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.click(
      within(dialog).getByRole("button", { name: "Start check" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command).toMatchObject({
      kind: "request_analysis",
      body: {
        kind: "page_check",
        maxProviderCalls: 0,
        scopeId: workspace.scope.id,
        expectedScopeVersion: 2,
      },
    });
    expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
      "coworkerId",
    );
  });

  it.each([false, undefined])(
    "keeps unapproved paid operations out of native checks (%s)",
    async (permission) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      workspace.availableActions.canUsePaidSearchData = permission;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace);
      await user.click(screen.getByRole("button", { name: "Run a check" }));
      const dialog = screen.getByRole("dialog");
      await user.click(
        within(dialog).getByRole("combobox", { name: "Check type" }),
      );
      expect(
        screen.queryByRole("option", { name: "Keyword positions" }),
      ).toBeNull();
      expect(
        screen.queryByRole("option", { name: "Backlink overview" }),
      ).toBeNull();
      expect(screen.queryByRole("option", { name: "Full audit" })).toBeNull();
      await user.click(screen.getByRole("option", { name: "Audit lite" }));
      expect(within(dialog).queryByLabelText("Keyword positions")).toBeNull();
      expect(
        within(dialog).queryByLabelText("Maximum data requests"),
      ).toBeNull();
      await user.click(
        within(dialog).getByRole("combobox", { name: "Search country" }),
      );
      await user.click(screen.getByRole("option", { name: "DE" }));
      await user.type(within(dialog).getByLabelText("Search language"), "de");
      await user.click(
        within(dialog).getByRole("button", { name: "Start check" }),
      );
      await waitFor(() => expect(mutate).toHaveBeenCalled());
      expect(mutate.mock.calls[0][0].command.body).toMatchObject({
        kind: "audit_lite",
        analyses: ["page.inspect"],
        maxProviderCalls: 0,
      });
      expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
        "coworkerId",
      );
    },
  );

  it("shows a paid-data budget only when Audit lite includes provider-backed checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Audit lite" }));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    await user.click(within(dialog).getByLabelText("Keyword positions"));
    expect(within(dialog).getByLabelText("Maximum data requests")).toHaveValue(
      20,
    );
    await user.clear(within(dialog).getByLabelText("Maximum data requests"));
    await user.type(
      within(dialog).getByLabelText("Maximum data requests"),
      "5",
    );
    await user.click(within(dialog).getByLabelText("Keyword positions"));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).getByLabelText("Maximum data requests")).toHaveValue(
      5,
    );
  });

  it("keeps unavailable first-use recovery inside SEO without promising a hidden check", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/imports?")
            ? { tasks: [], nextCursor: null }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    expect(screen.queryByRole("button", { name: "Run a check" })).toBeNull();
    expect(
      screen.queryByText(
        "Run a page check or import a completed report. Add related pages to compare them in one audit.",
      ),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "All audits" })).toHaveAttribute(
      "href",
      "/seo",
    );
    expect(
      screen.queryByRole("link", { name: /bot|coworker|assistant/i }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Import a report" }));
    expect(
      screen.getByRole("dialog", { name: "Import an audit" }),
    ).toBeVisible();
  });

  it("schedules finite native monitoring with its market and per-run budget", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Schedule checks" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    expect(
      screen.queryByRole("option", { name: "Full audit" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.type(
      within(dialog).getByLabelText("Keywords, one per line"),
      "stablecoins",
    );
    await user.clear(within(dialog).getByLabelText("Maximum data requests"));
    await user.type(
      within(dialog).getByLabelText("Maximum data requests"),
      "2",
    );
    await user.clear(within(dialog).getByLabelText("Number of runs"));
    const monitorForm = dialog.querySelector("form");
    if (!monitorForm) throw new Error("Missing monitor form");
    fireEvent.submit(monitorForm);
    expect(mutate).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText("Number of runs"), "2");
    await user.click(
      within(dialog).getByRole("button", { name: "Schedule checks" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "create_monitor",
        body: {
          operationId: expect.any(String),
          cadence: "weekly",
          timeZone: expect.any(String),
          targetRunCount: 2,
          analysis: expect.objectContaining({
            kind: "rankings",
            scopeId: workspace.scope.id,
            expectedScopeVersion: 2,
            countryCode: "DE",
            languageCode: "de",
            keywords: ["stablecoins"],
            maxProviderCalls: 2,
          }),
        },
      },
    });
    expect(mutate.mock.calls[0][0].command.body.analysis).not.toHaveProperty(
      "coworkerId",
    );
  });

  it.each([false, undefined])(
    "keeps one-off checks available without an approved scheduler (%s)",
    async (permission) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      workspace.availableActions.canCreateMonitor = permission;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      const view = renderWorkspace(workspace);
      expect(screen.getByRole("button", { name: "Run a check" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Schedule checks" }),
      ).toBeNull();
      expect(screen.queryByText("Monitoring")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Manage SEO" }));
      expect(
        screen.queryByRole("menuitem", { name: "Schedule checks" }),
      ).toBeNull();
      view.unmount();
      renderWorkspace(workspace, "", true);
      expect(
        screen.getByText("Scheduled checks are unavailable in this workspace."),
      ).toBeVisible();
      expect(screen.queryByText(messages.App.Seo.monitor.emptyBody)).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Schedule checks" }),
      ).toBeNull();
    },
  );

  it("blocks an open monitor form when scheduler readiness is withdrawn", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Schedule checks" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(messages.App.Seo.analysis.htmlService),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await act(async () => {
      view.client.setQueryData(
        ["seo-workspace", "org", "owner", "project", workspace.projectId, ""],
        {
          ...workspace,
          availableActions: {
            ...workspace.availableActions,
            canRequestAnalysis: false,
            canCreateMonitor: false,
          },
        },
      );
    });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Schedule checks" }),
      ).toBeDisabled(),
    );
    expect(
      within(dialog).queryByText(messages.App.Seo.analysis.htmlService),
    ).toBeNull();
    const form = dialog.querySelector("form");
    if (!form) throw new Error("Missing monitor form");
    fireEvent.submit(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears activity dates instead of claiming filtered reports are first-use results", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.scope.from = "2026-11-01";
    workspace.scope.to = "2026-11-02";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "from=2026-11-01&to=2026-11-02");
    expect(screen.queryByText(messages.App.Seo.overview.getStarted)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Clear activity dates" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText(messages.App.Seo.dateFrom)).toHaveValue("");
      expect(screen.getByLabelText(messages.App.Seo.dateTo)).toHaveValue("");
    });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/seo\?$/),
        expect.any(Object),
      ),
    );
  });

  it("records an explicit page-change note without editing the source page", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Manage SEO" }));
    await user.click(screen.getByRole("menuitem", { name: "Record a change" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("What changed?"),
      "Title update",
    );
    fireEvent.change(
      within(dialog).getByLabelText("When (device local time)"),
      { target: { value: "2026-01-01T13:00" } },
    );
    await user.type(
      within(dialog).getByLabelText("Details (optional)"),
      "Published in CMS",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record a change" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "record_page_change",
        body: {
          pageIds: workspace.scope.pageIds,
          occurredAt: new Date("2026-01-01T13:00"),
          title: "Title update",
          note: "Published in CMS",
          idempotencyKey: expect.any(String),
        },
      },
    });
  });

  it("retries selected report details without losing the Task or viewer binding", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const task = {
      id: "report-task",
      name: "Completed SEO check",
      assignee: { type: "coworker", id: "seo-coworker" },
      files: [
        {
          id: "ready-report",
          name: "seo-report-report-task.json",
          status: "READY",
          mimeType: "application/json",
          uploader: { type: "coworker", id: "seo-coworker" },
        },
      ],
    };
    const reads: Array<{ url: string; viewer: string | null }> = [];
    let detailReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/chat")) return Response.json({ turns: [] });
        if (!url.includes("/imports?")) return Response.json(workspace);
        reads.push({
          url,
          viewer: new Headers(init?.headers).get(SEO_VIEWER_HEADER),
        });
        if (url.includes("taskId=") && ++detailReads === 1)
          return Response.json(
            { message: "Temporary source failure" },
            { status: 503 },
          );
        return Response.json(
          url.includes("taskId=")
            ? { task }
            : { tasks: [task], nextCursor: null },
        );
      }),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(
      screen.getAllByRole("button", { name: "Import a report" })[0],
    );
    const dialog = screen.getByRole("dialog", { name: "Import an audit" });
    await user.click(
      await within(dialog).findByRole("combobox", { name: "Completed task" }),
    );
    await user.click(screen.getByRole("option", { name: task.name }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Failed to load audit sources",
    );
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(
      within(dialog).getByRole("combobox", { name: "Completed task" }),
    ).toHaveTextContent(task.name);
    await user.click(
      await within(dialog).findByRole("combobox", { name: "SEO report" }),
    );
    await user.click(screen.getByRole("option", { name: task.files[0].name }));
    expect(reads).toEqual([
      { url: `/api/seo/audits/${SEO_TEST_AUDIT}/imports?q=`, viewer: "owner" },
      {
        url: `/api/seo/audits/${SEO_TEST_AUDIT}/imports?taskId=${task.id}`,
        viewer: "owner",
      },
      {
        url: `/api/seo/audits/${SEO_TEST_AUDIT}/imports?taskId=${task.id}`,
        viewer: "owner",
      },
    ]);
    await user.click(
      within(dialog).getByRole("button", { name: "Import report" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "audit", id: SEO_TEST_AUDIT },
      command: {
        kind: "import_audit",
        body: { taskId: task.id, fileId: task.files[0].id },
      },
    });
  });

  it("shows newly synced Search Console metrics under the organic filter", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const measured = {
      ...workspace,
      metricsStatus: "available" as const,
      metrics: [
        {
          id: "clicks",
          key: "clicks",
          label: "Search clicks",
          unit: "count" as const,
          source: "search_console",
          propertyId: "sc-domain:example.com",
          channel: "organic" as const,
          value: 41,
          from: "2026-01-01",
          to: "2026-01-02",
          timeZone: "UTC",
          observedAt: new Date("2026-01-03T12:00:00Z"),
          coverage: "complete" as const,
          points: [],
          notes: [],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.endsWith("statistics/properties")) {
          const provider = url.searchParams.get("provider");
          return Response.json({
            provider,
            status: "available",
            reason: null,
            properties: [
              {
                id:
                  provider === "search_console"
                    ? "sc-domain:example.com"
                    : "properties/123",
                name: "Website property",
              },
            ],
          });
        }
        return Response.json(
          url.searchParams.get("channel") === "organic" ? measured : workspace,
        );
      }),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Source" }));
    await user.click(screen.getByRole("option", { name: "Search Console" }));
    await user.click(
      await within(dialog).findByRole("combobox", { name: "Property" }),
    );
    await user.click(screen.getByRole("option", { name: "Website property" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Sync statistics" }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "sync_statistics",
        body: expect.objectContaining({
          provider: "search_console",
          propertyId: "sc-domain:example.com",
          channel: "organic",
          scopeId: workspace.scope.id,
          expectedScopeVersion: 2,
        }),
      },
    });
    expect(await screen.findByText("41")).toBeVisible();
  });

  it("keeps connection management available when Google properties already exist", async () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/api/seo/connections/")
            ? {
                provider: "ga4",
                name: "Google Analytics",
                status: "connected",
                source: "native",
              }
            : url.includes("/statistics/properties")
              ? {
                  provider: "ga4",
                  status: "available",
                  reason: null,
                  properties: [
                    { id: "properties/123", name: "Current Google account" },
                  ],
                }
              : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    expect(
      await screen.findByRole("combobox", { name: "Property" }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", {
        name: "Disconnect Google Analytics",
      }),
    ).toBeVisible();
  });

  it("opens embedded SEO chat without assistant setup, navigation, or a paid send", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=keywords`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", { name: "SEO chat" });
    expect(within(panel).getByLabelText("Your question")).toBeVisible();
    expect(
      await within(panel).findByText("What would you like to improve?"),
    ).toBeVisible();
    expect(ensureRoom).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === `/api/seo/audits/${SEO_TEST_AUDIT}/chat`,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
    expect(
      within(panel).queryByText(
        /inbox|calendar|personal project manager|Soko Bot/i,
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Soko Bot|personal assistant/i }),
    ).toBeNull();
  });

  it("keeps a chat-proposed opportunity Task after a later Search Console sync", async () => {
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const opportunity = {
      id: "gsc:query:0123456789abcdef",
      observationId: crypto.randomUUID(),
      pageUrl: workspace.pages[0].url,
      findingIds: [],
      title: 'Review the search snippet for "battery health"',
      why: "This is a review suggestion, not a confirmed problem.",
      effort: "low" as const,
      expectedEffect: "No traffic change is promised.",
      edit: null,
      taskId: null,
      status: "recommended" as const,
      kind: "opportunity" as const,
      evidence: ["Heuristic: snippet review"],
    };
    workspace.actions = [opportunity];
    const history = {
      sharing: "personal",
      turns: [
        {
          id: crypto.randomUUID(),
          author: { id: "owner", name: "Sandro" },
          question: "What should I do first?",
          response: "Review the snippet.",
          status: "completed",
          // Proposed from the previous sync's observation.
          actions: [
            {
              kind: "task",
              observationId: crypto.randomUUID(),
              actionId: opportunity.id,
            },
          ],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? history : workspace),
      ),
    );
    renderWorkspace(workspace);
    // A turn from an earlier visit is folded on the Overview.
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Show 1 earlier question" }),
      );
    expect(
      await screen.findByRole("button", {
        name: `Create draft task: ${opportunity.title}`,
      }),
    ).toBeVisible();
  });

  it("folds an earlier visit's chat on the Overview and keeps this visit's answer across tabs", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turn = (question: string) => ({
      id: crypto.randomUUID(),
      question,
      response: `Answer to ${question}`,
      status: "completed",
      actions: [],
      scope: { pageIds: workspace.scope.pageIds },
      createdAt: new Date().toISOString(),
    });
    const turns = [turn("Earlier visit question")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        const next = turn(JSON.parse(String(init.body)).question);
        turns.push(next);
        return Response.json(next);
      }),
    );
    renderWorkspace(workspace);
    expect(
      await screen.findByRole("button", { name: "Show 1 earlier question" }),
    ).toBeVisible();
    expect(screen.queryByText("Earlier visit question")).toBeNull();
    await user.type(screen.getByLabelText("Your question"), "New question");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Answer to New question")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Keywords" }));
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("Answer to New question")).toBeVisible();
    expect(screen.queryByText("Earlier visit question")).toBeNull();
  });

  it("loads the Overview chat history when the app keeps fresh server data", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns = [
      {
        id: crypto.randomUUID(),
        question: "Earlier visit question",
        response: "Earlier answer",
        status: "completed",
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat") ? { sharing: "personal", turns } : workspace,
        ),
      ),
    );
    // The app's query client keeps data fresh for a minute.
    renderWorkspace(workspace, "", false, 60_000);
    expect(
      await screen.findByRole("button", { name: "Show 1 earlier question" }),
    ).toBeVisible();
    expect(screen.queryByText(messages.App.Seo.loading)).toBeNull();
  });

  it("shows the server results while the session loads, then reads the chat history", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns = [
      {
        id: crypto.randomUUID(),
        question: "Earlier visit question",
        response: "Earlier answer",
        status: "completed",
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat") ? { sharing: "personal", turns } : workspace,
        ),
      ),
    );
    viewer.userId = null;
    const view = renderWorkspace(workspace, "", false, 60_000);
    expect(screen.getByText(messages.App.Seo.agent.title)).toBeVisible();
    viewer.userId = "owner";
    view.refreshViewer();
    expect(screen.getByText(messages.App.Seo.agent.title)).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Show 1 earlier question" }),
    ).toBeVisible();
  });

  it("loads the Overview chat history when returning to an Audit with fresh cached data", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns = [
      {
        id: crypto.randomUUID(),
        question: "Earlier visit question",
        response: "Earlier answer",
        status: "completed",
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat") ? { sharing: "personal", turns } : workspace,
        ),
      ),
    );
    // A first visit on another tab caches the Audit without reading the chat.
    const first = renderWorkspace(workspace, "?tab=keywords", false, 60_000);
    await screen.findByRole("tab", { name: "Keywords", selected: true });
    // The first mount read must finish, so the cache is fresh when the Audit opens again.
    await waitFor(() =>
      expect(
        first.client
          .getQueryCache()
          .findAll({ predicate: (query) => query.state.dataUpdateCount > 0 }),
      ).not.toHaveLength(0),
    );
    first.unmount();
    render(
      <QueryClientProvider client={first.client}>
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          formats={createFormats()}
          messages={messages}
        >
          <NuqsTestingAdapter searchParams="" hasMemory>
            <SeoWorkspace workspace={workspace} />
          </NuqsTestingAdapter>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "Show 1 earlier question" }),
    ).toBeVisible();
  });

  it("keeps an answer asked in the chat sheet on another tab visible on the Overview", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turns: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        const question = JSON.parse(String(init.body)).question;
        const next = {
          id: crypto.randomUUID(),
          question,
          response: `Answer to ${question}`,
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        };
        turns.push(next);
        return Response.json(next);
      }),
    );
    renderWorkspace(workspace, "tab=actions");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByText(messages.App.Seo.chat.empty);
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "Sheet question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send message" }),
    );
    expect(
      await within(sheet).findByText("Answer to Sheet question"),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("Answer to Sheet question")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Show 1 earlier question" }),
    ).toBeNull();
  });

  it("keeps an answer in view when the question is sent before chat history loads", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const turn = {
      id: crypto.randomUUID(),
      question: "Early question",
      response: "Answer before history loaded",
      status: "completed",
      actions: [],
      scope: { pageIds: workspace.scope.pageIds },
      createdAt: new Date().toISOString(),
    };
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") return Response.json(turn);
        // The first history read never answers; the read after the send returns the new turn.
        reads += 1;
        if (reads === 1) return new Promise<Response>(() => {});
        return Response.json({ sharing: "personal", turns: [turn] });
      }),
    );
    renderWorkspace(workspace);
    await user.type(
      await screen.findByLabelText("Your question"),
      "Early question",
    );
    await user.click(screen.getByRole("button", { name: "Send message" }));
    expect(
      await screen.findByText("Answer before history loaded"),
    ).toBeVisible();
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(screen.getByText("Answer before history loaded")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /earlier question/ }),
    ).toBeNull();
  });

  it("identifies a shared organization conversation and its member author", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
      sharing: "organization" as const,
    };
    const history = {
      sharing: "organization",
      turns: [
        {
          id: crypto.randomUUID(),
          author: { id: "another-member", name: "Alex" },
          question: "Which pages need attention?",
          response: "The saved audit has no measured results yet.",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        },
      ],
    };
    history.turns.push({
      ...history.turns[0],
      id: crypto.randomUUID(),
      author: { id: "owner", name: "Sandro" },
      question: "Which source should I connect?",
      response: "Connect Search Console to read search measurements.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? history : workspace),
      ),
    );
    renderWorkspace(workspace, "tab=keywords");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", { name: "SEO chat" });
    await within(panel).findByText(history.turns[0].response);
    expect(within(panel).getByText("Alex")).toBeVisible();
    expect(within(panel).getByText("You")).toBeVisible();
    expect(
      within(panel).getByText(
        "This conversation and saved statistics are shared within this audit in your organization.",
      ),
    ).toBeVisible();
    expect(within(panel).queryByText(/visible only to you/)).toBeNull();
  });

  it("shows the Actions tab only once the Audit has actions", async () => {
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Keywords" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Actions" })).toBeNull();
  });

  it("hides labels, notes and filters that cannot change anything without paid data", async () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.keywords.push({
      id: "saved-keyword",
      keyword: "Stablecoins",
      countryCode: "DE",
      languageCode: "de",
      pageUrl: workspace.pages[0].url,
      targetPageId: workspace.pages[0].id,
      saved: true,
      priority: "medium",
      version: 1,
      source: "saved",
      volume: null,
      intent: null,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      observedAt: null,
      observationId: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=keywords");
    expect(await screen.findByText("Stablecoins")).toBeVisible();
    // Every row is tracked, paid columns can never fill, and no Analytics data exists.
    expect(screen.queryByText("Tracked")).toBeNull();
    expect(screen.queryByText(/Search volume/)).toBeNull();
    expect(screen.queryByText(/Tracking a keyword is free/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Traffic" })).toBeNull();
  });

  it("explains organization statistics sharing before a sync", async () => {
    const workspace = {
      ...seoTestWorkspace(),
      sharing: "organization" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.includes("/statistics/properties")
            ? {
                provider: "ga4",
                status: "not_connected",
                reason: null,
                properties: [],
              }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    const dialog = await screen.findByRole("dialog", {
      name: "Sync statistics",
    });
    expect(
      within(dialog).getByText(
        "Saved statistics are shared within this audit in your organization. Your Google account stays under your control.",
      ),
    ).toBeVisible();
  });

  it("keeps personal workspace chat privacy explicit", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      sharing: "personal" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat")
            ? { sharing: "personal", turns: [] }
            : workspace,
        ),
      ),
    );
    renderWorkspace(workspace, "?tab=keywords");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await screen.findByText(
        "This conversation and your connected statistics are visible only to you.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/shared within this audit/)).toBeNull();
  });

  it("does not retain another viewer's private unsent SEO question", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    const view = renderWorkspace(workspace, "?tab=keywords");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    await user.type(
      screen.getByLabelText("Your question"),
      "Private launch budget",
    );
    viewer.userId = "another-owner";
    view.refreshViewer();
    await waitFor(() =>
      expect(screen.getByLabelText("Your question")).not.toHaveValue(
        "Private launch budget",
      ),
    );
  });

  it.each(["resolves", "rejects"] as const)(
    "does not fetch the next viewer's private history into an old viewer's cache when a pending send %s",
    async (settlement) => {
      const user = userEvent.setup();
      const workspace = {
        ...seoTestWorkspace(),
        auditId: SEO_TEST_AUDIT,
        auditName: "Launch pages",
      };
      const turn = (question: string) => ({
        id: crypto.randomUUID(),
        question,
        status: "completed" as const,
        response: `${question} reply`,
        actions: [],
        scope: { pageIds: workspace.scope.pageIds },
        createdAt: new Date().toISOString(),
      });
      const oldHistory = { turns: [turn("Owner private history")] };
      const nextHistory = { turns: [turn("Next viewer private history")] };
      const chatReads: string[] = [];
      let resolvePost: (response: Response) => void = () => {};
      let rejectPost: (error: Error) => void = () => {};
      const pendingPost = new Promise<Response>((resolve, reject) => {
        resolvePost = resolve;
        rejectPost = reject;
      });
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") return pendingPost;
        chatReads.push(viewer.userId ?? "");
        return Response.json(
          viewer.userId === "owner" ? oldHistory : nextHistory,
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = renderWorkspace(workspace, "?tab=keywords");
      await user.click(
        screen.getByRole("button", { name: "Ask the SEO agent" }),
      );
      await screen.findByText("Owner private history reply");
      await user.type(
        screen.getByLabelText("Your question"),
        "Pending question",
      );
      await user.click(screen.getByRole("button", { name: "Send message" }));
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);

      viewer.userId = "another-owner";
      view.refreshViewer();
      await screen.findByText("Next viewer private history reply");
      const oldKey = ["seo-chat", "org", "owner", SEO_TEST_AUDIT];
      expect(view.client.getQueryData(oldKey)).toEqual(oldHistory);
      const oldCacheQuestions: string[] = [];
      const unsubscribe = view.client.getQueryCache().subscribe(() => {
        oldCacheQuestions.push(
          ...(
            view.client.getQueryData<SeoAuditChatHistory>(oldKey)?.turns ?? []
          ).map((item) => item.question),
        );
      });
      const readsBeforeSettlement = [...chatReads];
      await act(async () => {
        if (settlement === "resolves")
          resolvePost(Response.json(turn("Pending question")));
        else rejectPost(new Error("Request failed after viewer switch"));
        await pendingPost.catch(() => null);
      });
      unsubscribe();

      expect(oldCacheQuestions).not.toContain("Next viewer private history");
      expect(view.client.getQueryData(oldKey)).toEqual(oldHistory);
      expect(chatReads).toEqual(readsBeforeSettlement);
      expect(
        screen.getByText("Next viewer private history reply"),
      ).toBeVisible();
    },
  );

  it("starts a fresh turn when the same scoped question is asked after a completed reply", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=keywords`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(question).toHaveValue(""));
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
    expect(requests[1].scope).toEqual({ pageId: workspace.pages[0].id });
  });

  it("keeps the attempt key when retrying an uncertain network response", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace, { uncertainFirst: true });
    renderWorkspace(workspace, "?tab=keywords");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey);
  });

  it("keeps a failed acknowledged question and gives its explicit retry a fresh attempt key", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    const requests = nativeChatNetwork(workspace, { failedFirst: true });
    renderWorkspace(workspace, "?tab=keywords");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  });

  it("creates one draft action Task with its source references and guards repeated clicks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: ["finding"],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    let resolve: (value: unknown) => void = () => {};
    mutate.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderWorkspace(workspace, "?tab=actions");
    await user.dblClick(
      screen.getByRole("button", { name: "Create draft task" }),
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "create_action_task",
        body: {
          observationId: workspace.actions[0].observationId,
          actionId: "action-row",
          idempotencyKey: expect.any(String),
        },
      },
    });
    await act(async () => {
      resolve({ ok: true, value: null });
    });
  });
});
