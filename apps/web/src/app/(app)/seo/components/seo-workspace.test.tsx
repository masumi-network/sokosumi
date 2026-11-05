import type {
  Coworker,
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
import { SEO_TEST_AUDIT, seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

const { mutate, viewer, ensureRoom, push } = vi.hoisted(() => ({
  mutate: vi.fn(),
  viewer: { userId: "owner" },
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
    data: {
      session: { activeOrganizationId: "org" },
      user: { id: viewer.userId },
    },
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

function renderWorkspace(
  workspace: ProjectSeoWorkspace,
  searchParams = "",
  coworkers: Coworker[] = [],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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
          <SeoWorkspace workspace={workspace} coworkers={coworkers} />
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
              <SeoWorkspace workspace={workspace} coworkers={coworkers} />
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
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("SEO workspace integration", () => {
  it("renders source measurements without replacing missing values with zero", async () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "partial";
    const metric = {
      id: "views",
      key: "page_views",
      label: "Page views",
      unit: "count" as const,
      source: "ga4",
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
    expect(screen.getAllByText(/Europe\/Berlin/).length).toBe(2);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

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

  it("schedules finite monitoring with explicit Coworker, market and per-run budget", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace, "", [
      { id: "seo-coworker", name: "SEO Coworker" } as Coworker,
    ]);
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
    await user.type(within(dialog).getByLabelText("Number of runs"), "2");
    await user.click(
      within(dialog).getByRole("combobox", { name: "SEO coworker" }),
    );
    await user.click(screen.getByRole("option", { name: "SEO Coworker" }));
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
            coworkerId: "seo-coworker",
            maxProviderCalls: 2,
          }),
        },
      },
    });
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

  it("binds both import dialog reads to the current viewer before importing a ready report", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.includes("/imports?")) return Response.json(workspace);
        reads.push({
          url,
          viewer: new Headers(init?.headers).get(SEO_VIEWER_HEADER),
        });
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
    await user.click(screen.getByRole("button", { name: "Sync statistics" }));
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
    await userEvent.click(
      screen.getByRole("button", { name: "Sync statistics" }),
    );
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
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}`);
    await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
    const view = renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
        chatReads.push(viewer.userId);
        return Response.json(
          viewer.userId === "owner" ? oldHistory : nextHistory,
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const view = renderWorkspace(workspace);
      await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}`);
    await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "SEO chat" }));
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
