import type {
  ProjectSeoWorkspace,
  SeoAuditChatHistory,
  SyncProjectSeoStatisticsRequest,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
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
import * as publicEnv from "@/config/env.public";
import { createFormats } from "@/i18n/time-format";
import { SeoResultMessagesProvider } from "@/i18n/use-seo-result-translations";
import { setSeoAuditArchivedAction } from "@/lib/actions/seo/set-audit-archived";
import german from "../../../../../messages/de.json";
import messages from "../../../../../messages/en.json";
import { SeoAutomation } from "./seo-monitors";
import {
  openCheckOptions,
  openStatisticsSetup,
  SEO_TEST_AUDIT,
  SEO_TEST_PROJECT,
  seoTestCheckedAudit,
  seoTestMetric,
  seoTestObservation,
  seoTestStrategy,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate, saveGoal, viewer, ensureRoom, push } = vi.hoisted(() => ({
  mutate: vi.fn(),
  saveGoal: vi.fn(),
  viewer: { userId: "owner" as string | null, sessionId: "first-session" },
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
vi.mock("@/lib/actions/seo/set-audit-archived", () => ({
  setSeoAuditArchivedAction: vi.fn(),
}));
vi.mock("@/lib/actions/seo/save-brief", () => ({
  saveSeoBriefAction: saveGoal,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    // A null viewer is a session the client has not read yet.
    data: viewer.userId
      ? {
          session: { id: viewer.sessionId, activeOrganizationId: "org" },
          user: { id: viewer.userId },
        }
      : null,
  }),
}));

const clients: QueryClient[] = [];
const goalCopy = messages.App.Seo.setup.goal;
// Unrelated run/schedule cases use an already connected account. Connection cases keep their own fixtures.
function connectedSeoResponse(workspace: ProjectSeoWorkspace, url: string) {
  return Response.json(
    url.startsWith("/api/seo/connections/")
      ? {
          provider: url.endsWith("/ga4") ? "ga4" : "search_console",
          name: "Google",
          status: "connected",
          source: "native",
        }
      : workspace,
  );
}
async function readConnectedGoogle() {
  await waitFor(() =>
    expect(
      clients
        .at(-1)
        ?.getQueryData(["seo-connection", "org", "owner", "search_console"]),
    ).toMatchObject({ status: "connected" }),
  );
}

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
  return <SeoAutomation model={useSeoWorkspace(workspace)} />;
}
/** The runs Core sends with its checks: the runs row has a stop for each day with one. */
function runsOf(workspace: ProjectSeoWorkspace): ProjectSeoWorkspace["runs"] {
  return workspace.observations.map((observation) => ({
    observationId: observation.id,
    kind: observation.kind,
    observedAt: observation.observedAt,
    issues: observation.issues,
    seconds: null,
  }));
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
  viewer.sessionId = "first-session";
  saveGoal.mockReset();
});
afterEach(() => {
  sessionStorage.clear();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEO report archiving", () => {
  function renderReport({
    auditId = SEO_TEST_AUDIT,
    projectId = SEO_TEST_PROJECT,
    sharing = "organization",
    canEdit = true,
  }: {
    auditId?: string | null;
    projectId?: string | null;
    sharing?: ProjectSeoWorkspace["sharing"];
    canEdit?: boolean;
  }) {
    const base = seoTestWorkspace();
    const workspace = {
      ...base,
      auditId,
      projectId,
      sharing,
      auditName: auditId ? "Battery audit" : null,
      availableActions: { ...base.availableActions, canEdit },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    const { refreshViewer } = renderWorkspace(workspace);
    const menu = screen.getByRole("button", { name: messages.App.Seo.manage });
    return { menu, refreshViewer };
  }

  it("lets a teammate open and cancel archiving a shared audit by keyboard in a closed project", async () => {
    const user = userEvent.setup();
    viewer.userId = "teammate";
    const { menu } = renderReport({ canEdit: false });
    menu.focus();
    await user.keyboard("{ArrowDown}");
    const item = await screen.findByRole("menuitem", {
      name: "Archive report",
    });
    expect(screen.queryByRole("menuitem", { name: /delete/i })).toBeNull();
    await user.keyboard("{End}");
    await waitFor(() => expect(item).toHaveFocus());
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog", {
      name: /Battery audit/,
    });
    expect(dialog).toHaveAccessibleDescription(
      messages.App.Seo.audits.archiveDescription,
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(menu).toHaveFocus());
    expect(setSeoAuditArchivedAction).not.toHaveBeenCalled();
  });

  it("omits archiving in the project's own workspace", async () => {
    const user = userEvent.setup();
    await user.click(renderReport({ auditId: null }).menu);
    const menu = within(await screen.findByRole("menu"));
    expect(menu.queryByRole("menuitem", { name: "Archive report" })).toBeNull();
  });

  it("clears the open confirmation when another member views the same report", async () => {
    const user = userEvent.setup();
    const { menu, refreshViewer } = renderReport({});
    await user.click(menu);
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive report" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    for (const reader of ["teammate", "owner"]) {
      viewer.userId = reader;
      refreshViewer();
      expect(
        await screen.findByRole("button", { name: messages.App.Seo.manage }),
      ).toBeVisible();
      expect(screen.queryByRole("alertdialog")).toBeNull();
    }
    expect(setSeoAuditArchivedAction).not.toHaveBeenCalled();
  });

  it("submits once, allows retry after a conflict, and stops when access is lost", async () => {
    const user = userEvent.setup();
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof setSeoAuditArchivedAction>>
      >();
    vi.mocked(setSeoAuditArchivedAction)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "FORBIDDEN", status: 403 },
      });
    await user.click(
      renderReport({ projectId: null, sharing: "personal" }).menu,
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Archive report" }),
    );
    const dialog = within(await screen.findByRole("alertdialog"));
    const confirm = dialog.getByRole("button", { name: "Archive report" });
    await user.dblClick(confirm);
    expect(setSeoAuditArchivedAction).toHaveBeenCalledExactlyOnceWith({
      auditId: SEO_TEST_AUDIT,
      projectId: null,
      archived: true,
    });
    await user.keyboard("{Escape}");
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () =>
      pending.resolve({
        ok: false,
        error: {
          code: "CONFLICT",
          status: 409,
          kind: "seo_audit_resumable_monitor",
        },
      }),
    );
    expect(await dialog.findByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.archiveScheduled,
    );
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(dialog.getByRole("alert")).toHaveTextContent(
      messages.App.Seo.audits.archiveUnavailable,
    );
    expect(setSeoAuditArchivedAction).toHaveBeenCalledTimes(2);
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("SEO workspace integration", () => {
  it("opens market evidence in standalone Rankings with no keyword rows", async () => {
    const workspace = { ...seoTestCheckedAudit(), projectId: null };
    workspace.observations[0].pageMarketEvidence = {
      regionalVersions: [
        { country: "DE", language: "de", url: "https://example.com/de/" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace, "?tab=rankings");
    const markets = within(
      await screen.findByRole("region", { name: "Markets to investigate" }),
    );
    expect(markets.getByText("Germany · German")).toBeVisible();
  });

  it("offers report files for earlier imported runs without an analysis in the current window", async () => {
    const workspace = seoTestWorkspace();
    const history = seoTestObservation(workspace);
    workspace.observations = [
      { ...history, sourceTaskId: "historic-task" },
      {
        ...history,
        id: "recent",
        sourceTaskId: "recent-task",
        observedAt: new Date("2026-11-05T12:00:00Z"),
      },
    ];
    workspace.runs = runsOf(workspace);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace, "to=2026-01-03");
    await userEvent.click(screen.getByRole("button", { name: "Report files" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/Page check · Jan 3, 2026/)).toBeVisible();
    expect(dialog.queryByText(/Nov 5, 2026/)).toBeNull();
  });

  it("shows the audit timeline after a single completed audit", () => {
    const workspace = seoTestWorkspace();
    workspace.runs = [
      {
        observationId: "first-audit",
        kind: "audit_full",
        observedAt: new Date("2026-11-12T13:00:00Z"),
        issues: 5,
        seconds: 600,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace);
    const timeline = screen.getByRole("group", { name: "Checks" });
    expect(
      within(timeline).getByRole("button", { name: /^Nov 12/ }),
    ).toBeVisible();
  });

  it("shows the audit timeline while the first audit is running", () => {
    const workspace = seoTestWorkspace();
    workspace.runs = [];
    workspace.analyses = [
      {
        id: crypto.randomUUID(),
        kind: "audit_full",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: workspace.scope.version,
        createdAt: new Date(),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace);
    expect(
      within(screen.getByRole("group", { name: "Checks" })).getByText(
        "Running",
      ),
    ).toBeVisible();
  });

  it.each([false, true])(
    "keeps property selection with statistics instead of above the audit (existing metrics: %s)",
    async (measured) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      if (measured)
        workspace.metrics = [
          { ...seoTestMetric(), source: "ga4", propertyId: "properties/old" },
        ];
      const network = vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.includes("/connections/")) {
          const provider = url.pathname.split("/").at(-1);
          return Response.json({
            provider,
            name: provider,
            source: "native",
            status: provider === "ga4" ? "connected" : "not_connected",
          });
        }
        if (url.pathname.endsWith("/statistics/properties"))
          return Response.json({
            provider: "ga4",
            status: "available",
            properties: [
              { id: "properties/1", name: "First" },
              { id: "properties/2", name: "Second" },
            ],
            reason: null,
          });
        if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
        return Response.json(workspace);
      });
      vi.stubGlobal("fetch", network);
      const { client } = renderWorkspace(workspace);
      await waitFor(() =>
        expect(
          network.mock.calls.some(([url]) =>
            url.includes("/statistics/properties"),
          ),
        ).toBe(true),
      );
      await waitFor(() => expect(client.isFetching()).toBe(0));
      const prompt =
        "Choose a Google property to load statistics for these pages.";
      expect(screen.queryByText(prompt)).toBeNull();
      await user.click(screen.getByRole("tab", { name: "Traffic" }));
      const traffic = screen.getByRole("tabpanel", { name: "Traffic" });
      expect(within(traffic).getByText(prompt)).toBeVisible();
      await user.click(
        within(traffic).getByRole("button", { name: "Choose a property" }),
      );
      expect(await screen.findByRole("dialog")).toBeVisible();
    },
  );

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

  it("opens the page details beside a short Actions list and offers statistics after limited checks", async () => {
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
    renderWorkspace(workspace, "?tab=health");
    // No action rows: the tab would look empty, so the measurements start open.
    const measurement = screen.getByText("Title length measured:");
    expect(measurement).toBeVisible();
    expect(measurement.closest("details")).toHaveAttribute("open");
    await user.click(
      screen.getByText("Check details", { selector: "summary" }),
    );
    expect(screen.getByTestId("seo-summary-tests")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    await user.click(
      screen.getAllByRole("button", { name: "Set up statistics" })[0],
    );
    expect(
      await screen.findByRole("dialog", { name: "Google connections" }),
    ).toBeVisible();
  });

  it.each([
    [3, true],
    [4, false],
  ])("with %i action rows, opens the page details: %s", (rows, open) => {
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
      evidence: ["The title has 42 characters."],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // 3 rows leave room for open details; one more row keeps them closed.
    for (let n = 1; n <= rows; n++)
      workspace.actions.push({
        id: `suggestion-${n}`,
        observationId: workspace.observations[0].id,
        pageUrl: workspace.pages[0].url,
        findingIds: [],
        title: `Suggestion ${n}`,
        why: "A search shows the page.",
        effort: "low",
        expectedEffect: "More people see the page.",
        edit: null,
        taskId: null,
        status: "recommended",
        kind: "opportunity",
        evidence: [],
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    expect(screen.getAllByText(/^Suggestion \d$/)).toHaveLength(rows);
    const measurement = screen.getByText("Title length measured:");
    expect(measurement.closest("details")?.hasAttribute("open")).toBe(open);
  });

  it("lets the first check decide whether the page details open", async () => {
    const empty = seoTestWorkspace();
    const checked = seoTestWorkspace();
    checked.observations.push({
      id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: checked.scope.pageIds,
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
    checked.findings.push({
      id: "measured-title",
      observationId: checked.observations[0].id,
      pageUrl: checked.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Title length measured",
      severity: "measure",
      evidence: ["The title has 42 characters."],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    for (let n = 1; n <= 4; n++)
      checked.actions.push({
        id: `suggestion-${n}`,
        observationId: checked.observations[0].id,
        pageUrl: checked.pages[0].url,
        findingIds: [],
        title: `Suggestion ${n}`,
        why: "A search shows the page.",
        effort: "low",
        expectedEffect: "More people see the page.",
        edit: null,
        taskId: null,
        status: "recommended",
        kind: "opportunity",
        evidence: [],
      });
    // The tab opens before any check; the first check then brings a long list.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(checked)),
    );
    renderWorkspace(empty, "?tab=actions");
    const measurement = await screen.findByText("Title length measured:");
    expect(screen.getAllByText(/^Suggestion \d$/)).toHaveLength(4);
    expect(measurement.closest("details")).not.toHaveAttribute("open");
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
      // The row drops the source prefix, like the other lists of checks.
      title: "Raw HTML: The page has no description",
      severity: "major",
      evidence: ["Raw HTML evidence: no meta description element."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(
      screen.getByRole("heading", {
        name: "Issue: The page has no description",
      }),
    ).toBeVisible();
    // No action fixes this issue, so no link promises a fix.
    expect(
      screen.queryByRole("button", { name: /^Fix: |^See the fix$/ }),
    ).toBeNull();
    const evidence = screen.getByText(
      "Raw HTML evidence: no meta description element.",
    );
    expect(evidence).not.toBeVisible();
    // The row is the switch: it opens the evidence of its issue.
    await user.click(
      screen.getByRole("heading", {
        name: "Issue: The page has no description",
      }),
    );
    expect(evidence).toBeVisible();
  });

  it("keeps the issue verdict and its severity list in English on a German workspace", () => {
    const workspace = seoTestCheckedAudit();
    const observed = workspace.observations[0];
    observed.issues = 2;
    for (const severity of ["major", "minor"] as const) {
      workspace.findings.push({
        id: severity,
        observationId: observed.id,
        pageUrl: workspace.pages[0].url,
        device: "mobile",
        rowId: severity,
        title: "Review the page",
        severity,
        evidence: [],
        sourceRef: "html:head",
        observedAt: observed.observedAt,
      });
    }
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="de"
          messages={german}
          timeZone="UTC"
          formats={createFormats()}
        >
          <SeoResultMessagesProvider messages={messages.App.Seo}>
            <NuqsTestingAdapter hasMemory>
              <SeoWorkspace workspace={workspace} />
            </NuqsTestingAdapter>
          </SeoResultMessagesProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const verdict = screen.getByTestId("seo-agent-verdict");
    expect(verdict).toHaveAttribute("lang", "en");
    expect(verdict).toHaveTextContent(
      "2 issues to fix: 1 high impact and 1 low impact",
    );
  });

  it("shows an issue with a fix once, as the row of its fix, on the tab an old Health link opens", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";
    workspace.findings.push({
      id: "price",
      observationId,
      pageUrl: workspace.pages[0].url,
      device: "mobile",
      rowId: "SD-08",
      // A test name reads like a pass.
      title: "Markup matches the visible page",
      severity: "major",
      evidence: ["The markup says 6.99, the page shows 9.99. (prices in USD)"],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.actions.push({
      id: "fix-price",
      observationId,
      pageUrl: workspace.pages[0].url,
      findingIds: ["price"],
      title: "Make the markup price match the page",
      why: "The two prices differ.",
      effort: "low",
      expectedEffect: "One price.",
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
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The fix row names the check: an issue row over it would say the same thing twice.
    expect(
      screen.queryByRole("heading", {
        name: "Issue: Markup matches the visible page",
      }),
    ).toBeNull();
    const row = screen.getByRole("button", {
      name: /^Make the markup price match the page/,
    });
    expect(within(row).getByText("High impact")).toBeVisible();
    // The row names the page and what the check found in one line; the reasons wait in the dialog.
    expect(within(row).getByText("Home")).toBeVisible();
    expect(row).not.toHaveTextContent("The markup says 6.99");
    expect(screen.queryByText("The two prices differ.")).toBeNull();
    await user.click(row);
    const dialog = await screen.findByRole("dialog", {
      name: "Make the markup price match the page",
    });
    // The line alone can be a bare count, so the name of its check goes with it, and the rule's footnote.
    expect(
      within(dialog).getByText(
        "Issue: Markup matches the visible page. Found: The markup says 6.99, the page shows 9.99. (prices in USD)",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText("The two prices differ.")).toBeVisible();
    expect(within(dialog).getByText("One price.")).toBeVisible();
  });

  it("filters the Actions worklist by impact, with suggestions apart", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";
    const pageUrl = workspace.pages[0].url;
    const action: Omit<
      (typeof workspace.actions)[number],
      "id" | "title" | "findingIds"
    > = {
      observationId,
      pageUrl,
      why: "Why",
      effort: "low",
      expectedEffect: "Effect",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    for (const [id, severity] of [
      ["one", "critical"],
      ["two", "major"],
      ["three", "minor"],
    ] as const) {
      workspace.findings.push({
        id,
        observationId,
        pageUrl,
        device: "mobile",
        rowId: `R-${id}`,
        title: `Check ${id}`,
        severity,
        evidence: ["found"],
        sourceRef: "html:head",
        observedAt: new Date("2026-01-03T12:00:00Z"),
      });
      workspace.actions.push({
        ...action,
        id: `fix-${id}`,
        findingIds: [id],
        title: `Fix ${id}`,
      });
    }
    workspace.actions.push({
      ...action,
      id: "idea",
      findingIds: [],
      kind: "opportunity",
      title: "Write about chargers",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    const filters = screen.getByRole("group", { name: "Filter actions" });
    const titles = () =>
      within(screen.getByRole("list", { name: "Actions" }))
        .getAllByRole("button")
        .map(
          (row) =>
            row.textContent?.match(
              /^(Fix (one|two|three)|Write about chargers)/,
            )?.[0],
        );
    // Critical and high issues are one level, as their orange mark is.
    expect(
      within(filters)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["All4", "High impact2", "Low impact1", "Suggestions1"]);
    expect(
      within(filters).getByRole("button", { name: "All 4" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/They are not errors/)).toBeNull();
    // In the mixed list a suggestion says what it is in its dialog.
    await user.click(
      screen.getByRole("button", { name: "Write about chargers" }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByText(
        /They are not errors/,
      ),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(
      within(filters).getByRole("button", { name: "High impact 2" }),
    );
    expect(titles()).toEqual(["Fix one", "Fix two"]);
    await user.click(
      within(filters).getByRole("button", { name: "Low impact 1" }),
    );
    expect(titles()).toEqual(["Fix three"]);
    // Suggestions alone keep the line that says they are no errors.
    await user.click(
      within(filters).getByRole("button", { name: "Suggestions 1" }),
    );
    expect(titles()).toEqual(["Write about chargers"]);
    expect(screen.getByText(/They are not errors/)).toBeVisible();
  });

  it("puts the first step before the numbers, offers the agent only with an Audit, and names a page of the site by its path", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "962a86bb-5702-4d64-a6c4-15be5bf8ed80";
    const guide = "https://example.com/guides/a";
    workspace.findings.push({
      id: "price",
      observationId,
      pageUrl: guide,
      device: "mobile",
      rowId: "SD-08",
      title: "Markup matches the visible page",
      severity: "major",
      evidence: ["The markup says 6.99, the page shows 9.99."],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.actions.push({
      id: "fix-price",
      observationId,
      pageUrl: guide,
      findingIds: ["price"],
      title: "Make the markup price match the page",
      why: "The two prices differ.",
      effort: "low",
      expectedEffect: "One price.",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    workspace.actions.push({
      ...workspace.actions.at(-1)!,
      id: "fix-price-2",
      title: "Show one price in the markup",
    });
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 18,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      observationId,
      position: null,
      positionStatus: "not_in_range",
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    workspace.keywords.push(
      { ...read, id: "small", keyword: "charge timer", volume: 90 },
      { ...read, id: "large", keyword: "battery app", volume: 720 },
    );
    let served: ProjectSeoWorkspace = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/chat") ? { sharing: "personal", turns: [] } : served,
        ),
      ),
    );
    // A saved check: the result card leads, not the setup card.
    workspace.observations.push({
      id: observationId,
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 1,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    // A phone gets the same order as a wide screen.
    vi.stubGlobal("innerWidth", 375);
    renderWorkspace(workspace);
    // Without an Audit there is no agent to write to: no button offers one.
    expect(
      screen.queryByRole("button", { name: "Ask the SEO agent" }),
    ).toBeNull();
    // The first step is part of the verdict card: the headline says what is wrong, its figures how the
    // keywords do, the step what to do first. The pictures are a card of their own before it.
    const verdict = screen.getByTestId("seo-agent-verdict");
    const figures = screen.getByTestId("seo-agent-figures");
    const tiles = screen.getByTestId("seo-agent-graphics");
    const firstStep = screen.getByText("Make the markup price match the page");
    expect(verdict.parentElement).toContainElement(figures);
    expect(verdict.parentElement).not.toContainElement(tiles);
    expect(verdict.parentElement).toContainElement(firstStep);
    expect(
      figures.compareDocumentPosition(firstStep) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const leadList = screen.getByRole("list", { name: "The agent proposes" });
    expect(
      within(leadList).getByText("Make the markup price match the page"),
    ).toBeVisible();
    // The row is part of the verdict card: it has no frame of its own.
    expect(
      within(leadList).getByRole("button", {
        name: /^Make the markup price match the page/,
      }),
    ).not.toHaveClass("border");
    expect(
      tiles.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();
    // With an Audit one floating button leads to the agent. The page itself has no question field.
    served = { ...workspace, auditId: SEO_TEST_AUDIT };
    renderWorkspace(served);
    expect(
      screen.getAllByRole("button", { name: "Ask the SEO agent" }),
    ).toHaveLength(1);
    expect(screen.queryByLabelText("Your question")).toBeNull();
    // The page of the fix is a page of the site: its path, with the address as the link's name.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await user.click(
      screen.getByRole("button", {
        name: /^Make the markup price match the page/,
      }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByRole("link", {
        name: guide,
      }),
    ).toHaveTextContent(/^\/guides\/a$/);
    // Without its fix the issue has a row of its own under the cards.
    cleanup();
    served = { ...served, actions: [] };
    renderWorkspace(served, "?tab=actions");
    // One device says something; the page is its own part, so the open row can leave it to the link.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent === "Mobile · /guides/a",
      ),
    ).toBeVisible();
  });

  it("shortens the position measure to its result and keeps every line in a fold", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const lines = [
      '"macbook charge limit", Market US, en (location_code 2840), mobile, DataForSEO SERP of 2026-11-16 23:50:46 +00:00: 16 organic results read',
      "the page is not in the top 16 organic results",
      "an AI Overview shows and does not cite the page",
      "position rule: rank_group counts the items of one type (organic, featured_snippet), rank_absolute counts every result item (DataForSEO, N2-508)",
      '"mac battery health checker" (goal): the page is not in the top 18 organic results',
      '"macbook battery health" (goal): the page is not in the top 16 organic results',
    ];
    workspace.findings.push({
      id: "organic-position",
      observationId: "check-position",
      pageUrl: workspace.pages[0].url,
      device: "mobile",
      rowId: "query.serp.position",
      title: "Organic position per device",
      severity: "measure",
      evidence: lines,
      sourceRef: "serp:mobile",
      observedAt: new Date("2026-11-16T23:51:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    const row = screen.getByText("Google ranking").closest("li");
    if (!row) throw new Error("no position row");
    // The result leads; the other keywords are one line; the rule and the raw head wait in the fold.
    expect(row).toHaveTextContent(
      "Not in Google's top 15 for “macbook charge limit”",
    );
    // The Market reads as a country and a language, not as codes.
    expect(row).toHaveTextContent("Google · United States · English");
    // An AI Overview that leaves the page out shows only in the fold.
    expect(
      within(row).queryByText(
        "Google's AI Overview cites this page as a source",
      ),
    ).toBeNull();
    expect(
      within(row).getByText(/AI Overview shows and does not cite/),
    ).not.toBeVisible();
    expect(row).toHaveTextContent(
      "Also not in the top 15 for 2 other keywords",
    );
    const rule = within(row).getByText(/^position rule:/);
    expect(rule).not.toBeVisible();
    await user.click(within(row).getByText("All details"));
    expect(rule).toBeVisible();
    // The keywords themselves are on the Rankings tab.
    await user.click(within(row).getByRole("button", { name: "See rankings" }));
    expect(screen.getByRole("tab", { name: "Rankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says when Google's AI Overview cites the page", async () => {
    const workspace = seoTestWorkspace();
    workspace.findings.push({
      id: "organic-position-cited",
      observationId: "check-position",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "query.serp.position",
      title: "Organic position per device",
      severity: "measure",
      evidence: [
        '"häfen auf rügen", Market DE, de (location_code 2276), desktop, DataForSEO SERP of 2026-11-19 09:00:00 +00:00: 18 organic results read',
        "the page is not in the top 18 organic results",
        "the AI Overview cites the page",
      ],
      sourceRef: "serp:desktop",
      observedAt: new Date("2026-11-19T09:01:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    expect(
      screen.getByText("Google's AI Overview cites this page as a source"),
    ).toBeVisible();
  });

  it("says in plain words what a camera file name note found and lists the files by name", async () => {
    const workspace = seoTestWorkspace();
    const file =
      "https://i0.wp.com/telsche.blog/wp-content/uploads/2024/04/img_2696-1.jpg?resize=150%2C150&ssl=1";
    workspace.findings.push({
      id: "camera-names",
      observationId: "check-images",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "O-21",
      title: "Image file names",
      severity: "note",
      evidence: [
        "2 of 23 image file names",
        `camera file name: ${file}`,
        "camera file name: javascript:alert(1)",
      ],
      sourceRef: "html:img",
      observedAt: new Date("2026-11-19T10:00:00Z"),
    });
    workspace.findings.push({
      id: "alt-missing",
      observationId: "check-images",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "O-18",
      title: "Image alt text",
      severity: "note",
      evidence: [
        "1 of 23 images",
        "img without alt: https://example.com/a.png",
        "+2 more",
      ],
      sourceRef: "html:img",
      observedAt: new Date("2026-11-19T10:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    const heading = screen.getByRole("heading", {
      name: "2 of 23 images have a camera file name",
    });
    const row = heading.closest("li");
    if (!row) throw new Error("no note row");
    // The rule's own name is an internal label: the row does not show it.
    expect(row).not.toHaveTextContent("Image file names");
    expect(row).toHaveTextContent("for example harbor-at-sunset.jpg");
    // Each file shows by its name and opens the full address; a non-web value is text, not a link.
    expect(
      within(row).getByRole("link", { name: "img_2696-1.jpg" }),
    ).toHaveAttribute("href", file);
    expect(within(row).getByText("alert(1)")).not.toHaveAttribute("href");
    expect(row).not.toHaveTextContent("Found:");
    expect(row).not.toHaveTextContent("camera file name:");
    // Another rule's list says in words what its items are, counting the ones the bot left out.
    expect(screen.getByText("3 images without alt text")).toBeVisible();
    expect(screen.getByText("2 more the check did not list")).toBeVisible();
  });

  it("lists a broken links note's links by path with the site's answer", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const site = new URL(workspace.pages[0].url).origin;
    workspace.findings.push({
      id: "broken-links",
      observationId: "check-links",
      pageUrl: workspace.pages[0].url,
      device: "mobile",
      rowId: "IL-04",
      title: "Links reach live pages",
      severity: "note",
      evidence: [
        "13 of 43 link targets answer 400 or more (12 on the page's host)",
        `${site}/segeln-mit-kindern/ → 429`,
        "https://other.example/gone → 404",
        `${site}/rund-ruegen-segeln/haefen/ → 429`,
        `${site}/rund-ruegen-segeln/segeltoern/ → 429`,
        `${site}/buecher-ruegen-ostsee/ → 429`,
        "+8 more",
      ],
      sourceRef: "links",
      observedAt: new Date("2026-11-19T10:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    const row = screen
      .getByRole("heading", { name: "13 of 43 links lead to an error" })
      .closest("li");
    if (!row) throw new Error("no note row");
    expect(row).toHaveTextContent("404 means the page does not exist");
    expect(row).toHaveTextContent("check that link again before you change it");
    // A link on the page's own site shows its path; another site's shows its host too.
    expect(
      within(row).getByRole("link", { name: "/segeln-mit-kindern/" }),
    ).toHaveAttribute("href", `${site}/segeln-mit-kindern/`);
    expect(
      within(row).getByRole("link", { name: "other.example/gone" }),
    ).toBeVisible();
    expect(row).toHaveTextContent("/segeln-mit-kindern/ → 429");
    // A 404 is an error and gets the solid badge; a 429 only turned the check away, so its badge stays quiet.
    expect(within(row).getByText("404")).toHaveClass(
      "bg-semantic-destructive-solid",
    );
    for (const quiet of within(row).getAllByText("429"))
      expect(quiet).not.toHaveClass("bg-semantic-destructive-solid");
    // The first three links always show; the rest of the list opens on request.
    expect(row).toHaveTextContent("/rund-ruegen-segeln/haefen/ → 429");
    expect(row).not.toHaveTextContent("segeltoern");
    expect(row).not.toHaveTextContent("did not list");
    const toggle = within(row).getByRole("button", { name: "Show 2 more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(row).getByRole("link", { name: "/buecher-ruegen-ostsee/" }),
    ).toBeVisible();
    // Links the check counted but did not send cannot open; the list says so at its end.
    expect(row).toHaveTextContent("8 more the check did not list");
    expect(row).not.toHaveTextContent("+8 more");
    await user.click(within(row).getByRole("button", { name: "Show less" }));
    expect(row).not.toHaveTextContent("segeltoern");
    expect(row).not.toHaveTextContent("Links reach live pages");
  });

  it("keeps the found line of a camera file name note without a share line", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.findings.push({
      id: "camera-names-old",
      observationId: "check-images-old",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "O-21",
      title: "Image file names",
      severity: "note",
      evidence: ["camera file name: https://example.com/IMG_0001.jpg"],
      sourceRef: "html:img",
      observedAt: new Date("2026-11-19T10:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=actions");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    // No count to put in plain words: the rule's title leads, and the check's lines wait in a fold.
    const heading = screen.getByRole("heading", {
      name: "Images with a camera file name",
    });
    const row = heading.closest("li");
    if (!row) throw new Error("no note row");
    expect(row).toHaveTextContent("Names like IMG_1234.jpg");
    const line = within(row).getByText(
      "camera file name: https://example.com/IMG_0001.jpg",
    );
    expect(line).not.toBeVisible();
    await user.click(within(row).getByText("What the check found"));
    expect(line).toBeVisible();
  });

  it("splits page details into measurements and notes and folds their references", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    // An Audit has the agent chat, so notes can ask it.
    workspace.auditId = crypto.randomUUID();
    workspace.findings.push({
      id: "measured-title",
      observationId: "check-title",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 56 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.findings.push({
      id: "meta-keywords",
      observationId: "check-keywords",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "meta-keywords",
      title: "Raw HTML: No meta keywords",
      severity: "note",
      evidence: [
        `meta keywords in head: "${Array.from({ length: 30 }, (_, i) => `battery ${i}`).join(", ")}"`,
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:head",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // The same rule on a second page, outside the range: the first listed title row carries the guidance.
    workspace.findings.push({
      id: "measured-title-old",
      observationId: "check-title-old",
      pageUrl: "https://example.com/old",
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 80 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // A test-level row is a flagged rule too, though its name reads as a claim.
    workspace.findings.push({
      id: "ai-bots",
      observationId: "check-bots",
      pageUrl: "https://example.com/old",
      device: "desktop",
      rowId: "AC-22",
      title: "Raw HTML: AI search bots may fetch the page",
      severity: "test",
      evidence: [
        "https://example.com/robots.txt disallows OAI-SearchBot for this page",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "robots",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    // An older check measured the mobile title outside the range. Only the newest check of a
    // page's title counts as a suggestion, so this row is no suggestion and offers no fix.
    workspace.findings.push({
      id: "measured-title-older",
      observationId: "check-title-older",
      pageUrl: workspace.pages[0].url,
      device: "mobile",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 75 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
        "Source: raw HTML; the rendered DOM was not requested.",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-01T12:00:00Z"),
    });
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") return Response.json({ turns: [] });
        const question = JSON.parse(String(init.body)).question;
        asked.push(question);
        return Response.json({
          id: crypto.randomUUID(),
          question,
          response: "Draft",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
      }),
    );
    // happy-dom has no layout: the long note's clamp cuts its text here.
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(60);
    renderWorkspace(workspace, "?tab=health");
    // The folded section says whether opening it pays off.
    expect(screen.getByText("2 notes")).toBeInTheDocument();
    const detailsHeading = screen.getByRole("heading", {
      name: "Page details",
    });
    // The fold closes the Actions list: it sits in that section, under its rows.
    const actionsSection = detailsHeading.closest("section");
    expect(actionsSection).not.toBeNull();
    expect(
      within(actionsSection as HTMLElement).getByRole("heading", {
        level: 2,
        name: "Recommended actions",
      }),
    ).toBeInTheDocument();
    expect(detailsHeading.closest("details")).toHaveAttribute("open");
    // A measurement is one line; its value drops the words its name says.
    expect(screen.getAllByText("Title length:")[0]).toBeVisible();
    expect(screen.getByText("80 characters")).toBeVisible();
    // A value inside every tool range asks nothing, so it is left out.
    expect(screen.queryByText("56 characters")).toBeNull();
    // Notes sit under their own heading, so a rule name does not read as a claim about the page.
    expect(
      screen.getByRole("heading", {
        name: "Notes (2)",
      }),
    ).toBeVisible();
    // A note leads with what the check found; the rule name follows, so it does not read as a claim.
    expect(
      screen.getByRole("heading", { name: "meta keywords in head" }),
    ).toBeVisible();
    expect(screen.queryByText(/No meta keywords/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Measurements" })).toBeVisible();
    // A 1-page Audit does not repeat its URL on every row.
    const details = screen.getAllByText("Title length:")[0].closest("details");
    if (!details) throw new Error("Page details missing");
    expect(
      within(details)
        .queryAllByRole("link")
        .filter((link) => link.getAttribute("href") === workspace.pages[0].url),
    ).toHaveLength(0);
    // A row for a page removed since keeps its URL, so it is not read as this page's.
    expect(
      within(details)
        .getAllByRole("link")
        .some(
          (link) => link.getAttribute("href") === "https://example.com/old",
        ),
    ).toBe(true);
    // The fold counts suggestions apart from notes, as the Agent tab does.
    expect(details.querySelector("summary")).toHaveTextContent(
      /^Page details1 suggestion,\s*2 notesWhat we found on your pages\./,
    );
    // Rows from different checks keep their own date.
    expect(within(details).queryByText(/Checked on/)).toBeNull();
    expect(details.querySelectorAll("time")).toHaveLength(4);
    expect(
      screen.getByRole("heading", {
        name: "robots.txt blocks AI search bots",
      }),
    ).toBeVisible();
    // A measurement shows the check's guidance under its value, once per rule.
    // Rule IDs leave the shown line.
    expect(
      screen.getByText("Ranges SEO tools use: Ahrefs under 70"),
    ).toBeVisible();
    // Only the newest check's value outside a range is a suggestion; the older one is history.
    expect(
      screen.getAllByText(/outside the tool range \(Ahrefs\)/),
    ).toHaveLength(2);
    expect(
      screen.getByText(/Suggestion: outside the tool range \(Ahrefs\)/),
    ).toBeVisible();
    // A long note value starts folded and opens in place.
    const showAll = screen.getByRole("button", { name: "Show all" });
    expect(showAll).toHaveAttribute("aria-expanded", "false");
    const value = document.getElementById(
      showAll.getAttribute("aria-controls") ?? "",
    );
    expect(value).toHaveClass("line-clamp-3");
    await user.click(showAll);
    expect(value).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // Each note offers a question to the agent; a measurement offers a fix only when a tool range leaves it out.
    expect(
      screen.getAllByRole("button", { name: "Ask about this note" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Ask the agent for a fix" }),
    ).toHaveLength(1);
    // Provenance folds once: a line every row shares is listed once, without row names.
    const reference = screen.getByText(
      "Source: raw HTML; the rendered DOM was not requested.",
    );
    expect(reference).not.toBeVisible();
    expect(screen.queryByText("Check details")).toBeNull();
    await user.click(screen.getByText("1 source"));
    expect(reference).toBeVisible();
    expect(screen.queryByText(/N1-246/)).toBeNull();
    // A note on a page removed since names that page in the question; nothing is sent.
    await user.click(
      screen.getByRole("button", {
        name: "Ask about this note",
        description: "robots.txt blocks AI search bots https://example.com/old",
      }),
    );
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "What does “AI search bots may fetch the page” mean for https://example.com/old? Should I change anything?",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // A fix request is the Agent tab's, as a draft; the unsent note question stays above it.
    await user.click(
      screen.getByRole("button", {
        name: "Ask the agent for a fix",
        description: "Title length: https://example.com/old",
      }),
    );
    const question = within(await screen.findByRole("dialog")).getByLabelText(
      "Your question",
    ) as HTMLTextAreaElement;
    expect(question.value).toBe(
      "What does “AI search bots may fetch the page” mean for https://example.com/old? Should I change anything?\n\nThe check measured “Title length” on https://example.com/old as 80 characters, outside the range of Ahrefs. Draft a change and suggest it as an action I can approve.",
    );
    // Nothing is sent until the owner sends it.
    expect(asked).toEqual([]);
  });

  it("shows no page details when every value is inside every tool range", async () => {
    const workspace = seoTestWorkspace();
    workspace.findings.push({
      id: "measured-title",
      observationId: "check-title",
      pageUrl: workspace.pages[0].url,
      device: "desktop",
      rowId: "title-length",
      title: "Raw HTML: Title length",
      severity: "measure",
      evidence: [
        "title 56 characters",
        "vendor tools: Ahrefs under 70 (N1-246)",
      ],
      sourceRef: "html:title",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(await screen.findByRole("tab", { name: "Actions" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Page details" })).toBeNull();
  });

  it("offers one fix per suggestion and drafts it in the chat", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const measured = (device: "desktop" | "mobile", characters: number) => ({
      id: `description-${device}`,
      observationId: "check-description",
      pageUrl: workspace.pages[0].url,
      device,
      rowId: "description-length",
      title: "Raw HTML: Meta description length",
      severity: "measure" as const,
      evidence: [
        `meta description ${characters} characters`,
        "vendor tools: Ahrefs under 160 (N1-247)",
      ],
      sourceRef: "html:description",
      observedAt: new Date("2026-01-03T12:00:00Z"),
    });
    workspace.findings.push(measured("desktop", 163), measured("mobile", 170));
    const prompt = `The check measured “Meta description length” on ${workspace.pages[0].url} as 163 characters, outside the range of Ahrefs. Draft a change and suggest it as an action I can approve.`;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") return Response.json({ turns: [] });
        const question = JSON.parse(String(init.body)).question;
        asked.push(question);
        return Response.json({
          id: crypto.randomUUID(),
          question,
          response: "Draft",
          status: "completed",
          actions: [],
          scope: { pageIds: workspace.scope.pageIds },
          createdAt: new Date().toISOString(),
        });
      }),
    );
    renderWorkspace(workspace, "?tab=health");
    // Both device rows are the one suggestion; only its first row offers the fix.
    expect(await screen.findAllByText(/Suggestion: outside/)).toHaveLength(2);
    const fixes = screen.getAllByRole("button", {
      name: "Ask the agent for a fix",
    });
    expect(fixes).toHaveLength(1);
    await user.click(fixes[0]);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(prompt);
    expect(asked).toEqual([]);
  });

  it("names each page-detail row's page on a multi-page Audit", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "Blog",
    });
    const observation = {
      id: "one-check",
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.pages.map((page) => page.id),
      scopeVersion: 2,
      sourceTaskId: "one-check-task",
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const, "mobile" as const],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 4, skipped: 0, failed: 0 },
    };
    workspace.observations.push(observation);
    workspace.timeline.push({
      id: "one-check-event",
      kind: "check",
      title: "SEO check results imported",
      status: "completed",
      detail: "",
      at: observation.observedAt,
      pageIds: observation.pageIds,
      taskId: observation.sourceTaskId,
      observationId: observation.id,
    });
    workspace.findings.push(
      {
        id: "measured-title",
        observationId: observation.id,
        pageUrl: workspace.pages[0].url,
        device: "desktop",
        rowId: "title-length",
        title: "Raw HTML: Title length",
        severity: "measure",
        evidence: ["title 56 characters"],
        sourceRef: "html:title",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "measured-description",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "description-length",
        title: "Raw HTML: Meta description length",
        severity: "measure",
        evidence: ["meta description 120 characters"],
        sourceRef: "html:description",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "long-note",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "meta-keywords",
        title: "Raw HTML: No meta keywords",
        severity: "note",
        evidence: [`meta keywords in head: "${"battery, ".repeat(20)}"`],
        sourceRef: "html:head",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
      {
        id: "long-unlabelled-note",
        observationId: observation.id,
        pageUrl: workspace.pages[1].url,
        device: "mobile",
        rowId: "link-text",
        title: "Raw HTML: Descriptive link text",
        severity: "note",
        evidence: [
          `the page links with generic text ${"read more, ".repeat(12)}and no other words`,
        ],
        sourceRef: "html:links",
        observedAt: new Date("2026-01-03T12:05:00Z"),
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    workspace.runs = runsOf(workspace);
    renderWorkspace(workspace, "?tab=health");
    // A short Actions list leaves room: the page details start open.
    expect(
      screen.getByRole("heading", { name: "Page details" }).closest("details"),
    ).toHaveAttribute("open");
    const details = screen.getByText("Title length:").closest("details");
    if (!details) throw new Error("Page details missing");
    expect(
      within(details)
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === workspace.pages[0].url),
    ).toBe(true);
    // One check behind every row: its time and record show once, above the rows.
    expect(within(details).getByText(/Checked on/)).toBeInTheDocument();
    const times = details.querySelectorAll("time");
    expect(times).toHaveLength(1);
    expect(times[0].getAttribute("datetime")).toBe("2026-01-03T12:00:00.000Z");
    // The Timeline row links the check's results; the rows do not repeat the link.
    expect(
      within(details).queryAllByRole("link", { name: /View results/ }),
    ).toHaveLength(0);
    // A long line without a label is the value under its rule, not a heading.
    expect(
      within(details).getByRole("heading", {
        name: /^The check flagged this on the page\s*: Descriptive link text$/,
      }),
    ).toBeVisible();
    // A long note the clamp does not cut needs no toggle.
    expect(within(details).getByText(/^"battery, battery/)).toBeVisible();
    expect(
      within(details).queryByRole("button", { name: "Show all" }),
    ).toBeNull();
    // The details of the day in view link the check's results.
    await user.click(screen.getByRole("button", { name: /^Details of / }));
    expect(
      within(await screen.findByRole("dialog"))
        .getAllByRole("link", { name: /View results$/ })
        .map((link) => link.getAttribute("href")),
    ).toContain("/tasks/one-check-task");
  });

  it("leaves the date filter off the Agent tab unless dates are set", () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace);
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    unmount();
    // A set date filter still shows, so it can be cleared.
    const set = renderWorkspace(workspace, "?from=2026-01-01");
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    set.unmount();
    // An empty tab has nothing a date can narrow.
    const empty = renderWorkspace(workspace, "?tab=rankings");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    empty.unmount();
    // Statistics syncs alone give Site health nothing a date can narrow.
    workspace.timeline = [
      {
        id: "sync",
        kind: "metrics",
        title: "Search Console statistics synced",
        status: "complete",
        detail: "",
        at: new Date("2026-01-02T00:00:00Z"),
        pageIds: workspace.scope.pageIds,
        taskId: null,
        observationId: null,
      },
    ];
    const health = renderWorkspace(workspace, "?tab=health");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    health.unmount();
    // One other event has one date: a filter could only show it or hide it.
    workspace.timeline.push({
      ...workspace.timeline[0],
      id: "pages",
      kind: "scope",
      title: "Page selection changed",
    });
    const one = renderWorkspace(workspace, "?tab=health");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    one.unmount();
    // Two events are history a date can narrow.
    workspace.timeline.push({
      ...workspace.timeline[1],
      id: "pages-again",
      at: new Date("2026-01-05T00:00:00Z"),
    });
    const history = renderWorkspace(workspace, "?tab=health");
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    history.unmount();
    workspace.timeline = [];
    // Rankings change over time, so their tab offers the dates once two checks have rows.
    const check = {
      id: "first-check",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    };
    workspace.observations = [check];
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
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
    });
    // One check has one date.
    const single = renderWorkspace(workspace, "?tab=rankings");
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    single.unmount();
    workspace.observations = [{ ...check, id: "second-check" }, check];
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
  });

  it("offers quick periods where dates narrow the view, not on Traffic", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const traffic = renderWorkspace(workspace, "?tab=traffic&from=2026-01-01");
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Quick periods" })).toBeNull();
    traffic.unmount();
    renderWorkspace(workspace, "?tab=health&from=2026-01-01");
    expect(screen.getByRole("group", { name: "Quick periods" })).toBeVisible();
  });

  it("puts the runs on a timeline, newest on the right, with the date filter below the checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 6),
      run("2026-10-28T08:00:00Z", 7),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const runs = screen.getByRole("group", { name: "Checks" });
    expect(
      within(runs)
        .getAllByRole("button", { pressed: undefined })
        .map((button) => button.textContent),
    ).toEqual([
      "Oct 287 issues in this check",
      "Nov 106 issues in this check",
      "Nov 125 issues in this check",
      "Other dates",
    ]);
    // The timeline holds the one date filter: the header and the filter block have none.
    expect(screen.queryByRole("button", { name: "Filter by date" })).toBeNull();
    const dates = within(runs).getByRole("button", { name: "Other dates" });
    await user.click(dates);
    // A calendar under the stop, on the month of the first check, with the days of a check marked in words too.
    const calendar = await screen.findByRole("dialog");
    expect(within(calendar).getByText("October 2026")).toBeVisible();
    within(calendar).getByRole("button", {
      name: /October 28th, 2026, Day with a check/,
    });
    expect(
      within(calendar).getByRole("button", { name: /October 29th, 2026$/ }),
    ).toBeEnabled();
    // Before the first check no day can show a check: it is no choice.
    expect(
      within(calendar).getByRole("button", { name: /October 27th, 2026$/ }),
    ).toBeDisabled();
    // Two presses set the range and close the calendar; the line says what is in view, with the way back.
    await user.click(
      within(calendar).getByRole("button", { name: /October 28th, 2026/ }),
    );
    await user.click(
      within(calendar).getByRole("button", { name: /October 30th, 2026/ }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(/Showing Oct 28.+30\./)).toBeVisible();
    expect(dates).toHaveAttribute("data-active", "true");
    // Open again on a set range, a press starts a new range: it does not stretch the old one and close.
    await user.click(dates);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /October 31st, 2026/,
      }),
    );
    expect(await screen.findByText(/Showing Oct 31\./)).toBeVisible();
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Show the latest" }));
    await waitFor(() => expect(screen.queryByText(/Showing/)).toBeNull());
    expect(dates).toHaveAttribute("data-active", "false");
    // "Other dates" stands apart from the line of checks: on it, it read as a check still to come.
    expect(
      within(within(runs).getByRole("list")).queryByRole("button", {
        name: "Other dates",
      }),
    ).toBeNull();
    // With no range, the calendar boxes the day the page shows: a picked check, not the newest and not today.
    await user.click(within(runs).getByRole("button", { name: /^Nov 10/ }));
    await user.click(dates);
    const picked = await screen.findByRole("dialog");
    expect(
      within(picked)
        .getByRole("button", { name: /November 10th, 2026, Day with a check/ })
        .closest("td"),
    ).toHaveClass("bg-accent");
    // The focus starts on that day, so the ring and the box mark one day.
    expect(
      within(picked).getByRole("button", {
        name: /November 10th, 2026, Day with a check/,
      }),
    ).toHaveFocus();
    expect(
      within(picked)
        .getByRole("button", { name: /November 12th, 2026, Day with a check/ })
        .closest("td"),
    ).not.toHaveClass("bg-accent");
    await user.keyboard("{Escape}");
    // The stop stands on every tab, also where dates narrow nothing.
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: "Other dates" },
      ),
    ).toBeEnabled();
  });

  it("uses the selected day's issue total and moves older open findings into their own section", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const latest = { ...workspace.observations[0], issues: 5 };
    const previous = {
      ...latest,
      id: crypto.randomUUID(),
      observedAt: new Date("2026-01-01T12:00:00Z"),
      issues: 2,
    };
    workspace.observations = [latest, previous];
    workspace.runs = runsOf(workspace);
    workspace.findings = workspace.observations.flatMap((check) =>
      Array.from({ length: check.issues }, (_, index) => ({
        id: `${check.id}:${index}`,
        observationId: check.id,
        pageUrl: workspace.pages[0].url,
        device: "desktop" as const,
        rowId: `${check.id}-${index}`,
        title: `${check.id === previous.id ? "Previous" : "Current"} finding ${index + 1}`,
        severity: "minor" as const,
        evidence: [],
        sourceRef: "html:head",
        observedAt: check.observedAt,
      })),
    );
    const day = "2026-01-01";
    const historicalWorkspace = {
      ...workspace,
      scope: { ...workspace.scope, to: day },
      observations: [previous],
      findings: workspace.findings.filter(
        (row) => row.observationId === previous.id,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        connectedSeoResponse(
          url.includes(`to=${day}`) ? historicalWorkspace : workspace,
          url,
        ),
      ),
    );
    renderWorkspace(workspace, "?tab=actions");
    const stops = within(screen.getByRole("group", { name: "Checks" }));
    expect(
      stops.getByRole("button", { name: /Jan 3 5 issues in this check/ }),
    ).toBeVisible();
    expect(screen.getByTestId("seo-summary-issues")).toHaveTextContent(/^5/);
    const earlier = screen
      .getByRole("heading", { name: "Still open from earlier checks (2)" })
      .closest("section")!;
    expect(within(earlier).getAllByRole("listitem")).toHaveLength(2);
    expect(earlier).toHaveTextContent("Previous finding 2");
    expect(earlier).not.toHaveTextContent("Current finding");
    await user.click(
      stops.getByRole("button", { name: /Jan 1 2 issues in this check/ }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("seo-summary-issues")).toHaveTextContent(/^2/),
    );
    expect(
      screen.queryByRole("heading", { name: /Still open from earlier checks/ }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: /Previous finding 2/ }),
    ).toBeVisible();
  });

  it("keeps the Agent verdict scoped to a rankings-only day after a clean page check", () => {
    const workspace = seoTestCheckedAudit();
    workspace.runs = [
      ...(runsOf(workspace) ?? []),
      {
        observationId: crypto.randomUUID(),
        kind: "rankings",
        issues: null,
        seconds: null,
        observedAt: new Date("2026-01-04T12:00:00Z"),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No page check for the selected dates",
    );
  });

  it("shows a day's issue count only where it changed from the day before", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 5),
      run("2026-10-28T08:00:00Z", 7),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const runs = screen.getByRole("group", { name: "Checks" });
    expect(
      within(within(runs).getByRole("list"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "Oct 287 issues in this check",
      "Nov 105 issues in this check",
      "Nov 12",
    ]);
  });

  it("boxes in the calendar the day the line of checks marks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    workspace.runs = [
      run("2026-11-12T13:00:00Z", 5),
      run("2026-11-10T09:00:00Z", 6),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const boxed = async (search: string) => {
      const view = renderWorkspace(workspace, search);
      await user.click(
        within(screen.getByRole("group", { name: "Checks" })).getByRole(
          "button",
          { name: "Other dates" },
        ),
      );
      const calendar = await screen.findByRole("dialog");
      const days = within(calendar)
        .getAllByRole("gridcell")
        .filter((cell) => cell.classList.contains("bg-accent"))
        .map((cell) => cell.textContent);
      view.unmount();
      return days;
    };
    // No filter: the newest check.
    expect(await boxed("?tab=traffic")).toEqual(["12"]);
    // An end on a day with no check: the line marks the check before it, and so does the calendar.
    expect(await boxed("?tab=traffic&to=2026-11-11")).toEqual(["10"]);
    // A broken date: no one day is in view. (A range shows as the calendar's own selection.)
    expect(await boxed("?tab=traffic&to=2026-13-45")).toEqual([]);
  });

  it("mutes the calendar days without a check and opens no month before the first check", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    const run = (observedAt: string) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues: 5,
      seconds: 600,
    });
    workspace.runs = [run("2026-11-12T13:00:00Z"), run("2026-11-10T09:00:00Z")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await user.click(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: "Other dates" },
      ),
    );
    const calendar = await screen.findByRole("dialog");
    const cell = (day: string) =>
      within(calendar)
        .getAllByRole("gridcell")
        .find((item) => item.textContent === day);
    // The days with a check are the bright choices; a day without one is muted and still starts a range.
    expect(cell("9")).toHaveClass("text-muted-foreground");
    expect(cell("10")).not.toHaveClass("text-muted-foreground");
    expect(cell("12")).not.toHaveClass("text-muted-foreground");
    // November holds the first check: the month before it has none.
    expect(
      within(calendar).getByRole("button", { name: /previous month/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("links the results of the tests without their day where the line of checks names it", async () => {
    const workspace = seoTestWorkspace();
    const check = {
      ...seoTestObservation(workspace),
      sourceTaskId: "task-tests",
    };
    workspace.observations = [check];
    const at = new Date(check.observedAt);
    const older = new Date(at.getTime() - 2 * 86_400_000);
    workspace.runs = [
      {
        observationId: check.id,
        kind: check.kind,
        observedAt: at,
        issues: 2,
        seconds: 600,
      },
      {
        observationId: crypto.randomUUID(),
        kind: check.kind,
        observedAt: older,
        issues: 3,
        seconds: 600,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace, "?tab=health");
    const tests = await screen.findByTestId("seo-summary-tests");
    // The line over the tabs names the day of this check: the tile names its results alone, and opens them.
    expect(within(tests).queryByText(/^Last check/)).toBeNull();
    expect(
      within(tests).getByRole("link", { name: "View results" }),
    ).toHaveAttribute("href", `/tasks/${check.sourceTaskId}`);
    view.unmount();
    // A check without results to open: the tile names no link it cannot open.
    workspace.observations = [{ ...check, sourceTaskId: null }];
    const plain = renderWorkspace(workspace, "?tab=health");
    const untasked = await screen.findByTestId("seo-summary-tests");
    expect(within(untasked).queryByText(/View results|Last check/)).toBeNull();
    plain.unmount();
    workspace.observations = [check];
    // An older day in view: the tile still shows another check, so it dates it.
    renderWorkspace(
      workspace,
      `?tab=health&to=${older.toISOString().slice(0, 10)}`,
    );
    expect(await screen.findByTestId("seo-summary-tests")).toHaveTextContent(
      /Last check/,
    );
  });

  it.each([
    // A start alone runs to today.
    ["?tab=traffic&from=2026-11-05", /Showing Nov 5\b/],
    // An end on no day with a check is a range, not the pick of a check.
    ["?tab=traffic&to=2026-11-11", /Showing up to Nov 11\./],
    ["?tab=traffic&from=2026-11-12&to=2026-11-10", /end date on or after/],
    // A day the URL holds in another form narrows nothing either.
    ["?tab=traffic&from=soon", /end date on or after/],
    // A string compare would let this pass: "2026-11-12" is not after "soon".
    ["?tab=traffic&from=2026-11-12&to=soon", /end date on or after/],
    // The form of a day, but no day: Core refuses it as well.
    ["?tab=traffic&from=2026-02-30", /end date on or after/],
  ])(
    "says under the timeline which dates %s holds, with the way back",
    (search, note) => {
      const workspace = seoTestWorkspace();
      workspace.metrics = [seoTestMetric()];
      workspace.runs = ["2026-11-12T13:00:00Z", "2026-11-10T09:00:00Z"].map(
        (observedAt) => ({
          observationId: crypto.randomUUID(),
          kind: "audit_full",
          observedAt: new Date(observedAt),
          issues: 5,
          seconds: 600,
        }),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, search);
      expect(screen.getByText(note)).toBeVisible();
      expect(screen.queryByText(/Earlier check/)).toBeNull();
      expect(
        screen.getByRole("button", { name: "Show the latest" }),
      ).toBeVisible();
    },
  );

  it("links the home page from a title that is its host, with no address line under it", async () => {
    const pageLinks = async (auditName: string) => {
      const workspace = { ...seoTestWorkspace(), auditName };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      const title = await screen.findByRole("heading", {
        level: 2,
        name: auditName,
      });
      const found = {
        title,
        address: screen.queryAllByRole("link", { name: "https://example.com/" })
          .length,
      };
      return found;
    };
    // A typed name keeps its address line under it.
    const typed = await pageLinks("Launch pages");
    expect(within(typed.title).queryByRole("link")).toBeNull();
    cleanup();
    const home = await pageLinks("example.com");
    expect(
      within(home.title).getByRole("link", { name: "example.com" }),
    ).toHaveAttribute("href", "https://example.com/");
    expect(home.address).toBe(typed.address - 1);
  });

  it("keeps the page in view while another day loads, without a jump back to the first read", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    workspace.auditName = "First read";
    workspace.runs = ["2026-11-12T13:00:00Z", "2026-11-10T09:00:00Z"].map(
      (observedAt) => ({
        observationId: crypto.randomUUID(),
        kind: "audit_full",
        observedAt: new Date(observedAt),
        issues: 5,
        seconds: 600,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        // The read of the older day does not answer while the test looks.
        String(url).includes("to=")
          ? new Promise(() => {})
          : Promise.resolve(
              Response.json({ ...workspace, auditName: "Fresh read" }),
            ),
      ),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await screen.findByRole("heading", { name: "Fresh read" });
    await user.click(
      within(screen.getByRole("group", { name: "Checks" })).getByRole(
        "button",
        { name: /^Nov 10/ },
      ),
    );
    expect(screen.getByRole("heading", { name: "Fresh read" })).toBeVisible();
    // The page says that its numbers are not of the picked day yet.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("folds empty date fields opened on another tab when the Agent tab opens", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    expect(screen.getByLabelText("Activity from")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    expect(screen.queryByLabelText("Activity from")).toBeNull();
  });

  it("keeps an Agent tab date field while its date is cleared mid-edit", async () => {
    const workspace = seoTestWorkspace();
    // No other filter: the date fields alone keep the filter block.
    workspace.availableActions.canEdit = false;
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?from=2026-01-01");
    const from = screen.getByLabelText("Activity from");
    // A date input reports an empty value as soon as one part is cleared.
    fireEvent.change(from, { target: { value: "" } });
    await waitFor(() => expect(from).toHaveValue(""));
    expect(screen.getByLabelText("Activity from")).toBe(from);
  });

  it("puts the filters under the tabs so the tab row stays put", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [seoTestMetric()];
    // One page and no saved selection: the header has no page picker.
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace, "?tab=traffic");
    const after = (name: string) =>
      screen
        .getByRole("tablist")
        .compareDocumentPosition(screen.getByRole("button", { name })) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(after("Filter by date")).toBeTruthy();
    view.unmount();
    // With a page picker the header has a line on every tab: the closed filter stands in it and adds no row.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blogs",
      relationship: "related",
      relatedToPageId: workspace.pages[0].id,
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    renderWorkspace(workspace, "?tab=traffic");
    expect(after("Filter by date")).toBeFalsy();
    expect(
      screen.getByRole("button", { name: "Filter by date" }).parentElement,
    ).toContainElement(screen.getByRole("combobox", { name: "Pages" }));
  });

  it("opens the folded filter block when the header's date filter is pressed", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    // Google Analytics data adds the traffic choice, so a phone folds the filter block.
    workspace.metrics = [{ ...seoTestMetric(), source: "ga4" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const fold = screen.getByRole("button", { name: "Filters" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: "Filter by date" }));
    // The date fields stand in that block: a press that opened them in a closed block would show nothing.
    expect(fold).toHaveAttribute("aria-expanded", "true");
  });

  it("puts no badge on a page while the Audit has one primary page", () => {
    const workspace = seoTestWorkspace();
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
    renderWorkspace(workspace, "?tab=health");
    const pages = screen
      .getByRole("heading", { name: "Pages", level: 2 })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    const rows = within(pages).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("https://example.com/")).toBeVisible();
    expect(within(rows[0]).queryByText(/page$/)).toBeNull();
    // One primary page: the names tell the two pages apart, so no badge and no "Related to" line.
    expect(
      within(rows[1]).getByRole("heading", { name: "Blog" }),
    ).toBeVisible();
    expect(within(rows[1]).queryByText("Related page")).toBeNull();
    expect(within(rows[1]).queryByText(/^Related to/)).toBeNull();
  });

  it("names the parent of a related page when it is not the primary page", () => {
    const workspace = seoTestWorkspace();
    const blog = {
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blogs",
      label: "Blog",
      relationship: "related" as const,
      relatedToPageId: workspace.pages[0].id,
    };
    workspace.pages.push(blog, {
      ...blog,
      id: crypto.randomUUID(),
      url: "https://example.com/blogs/post",
      label: "Post",
      relatedToPageId: blog.id,
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    const row = screen.getByRole("heading", { name: "Post" }).closest("li");
    if (!row) throw new Error("Page row missing");
    expect(within(row).getByText("Related to: Blog")).toBeVisible();
  });

  it("shows the saved selections card only once a selection exists", () => {
    const workspace = seoTestWorkspace();
    workspace.pages.push(
      {
        ...workspace.pages[0],
        id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
        url: "https://example.com/pricing",
      },
      // With two pages a selection is one page or both; the offer starts at three.
      {
        ...workspace.pages[0],
        id: "b758c5bb-3084-4b26-81ee-b3208ee5ab62",
        url: "https://example.com/about",
      },
    );
    const saved = workspace.scopes;
    workspace.scopes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(workspace, "?tab=health");
    expect(
      screen.queryByRole("heading", { name: "Saved page selections" }),
    ).toBeNull();
    // The way to save the first selection sits in the Pages card.
    const pages = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    expect(
      within(pages).getByRole("button", { name: "Save page selection" }),
    ).toBeVisible();
    unmount();
    workspace.scopes = saved;
    renderWorkspace(workspace, "?tab=health");
    const card = screen
      .getByRole("heading", { name: "Saved page selections" })
      .closest("section");
    if (!card) throw new Error("Selections card missing");
    expect(
      within(card).getByRole("button", { name: "Save page selection" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Save page selection" }),
    ).toHaveLength(1);
  });

  it("hides the page picker when the only page is the one selected", () => {
    const workspace = seoTestWorkspace();
    workspace.scopes = [];
    workspace.metrics = [seoTestMetric()];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const { unmount } = renderWorkspace(
      workspace,
      `?tab=traffic&pageId=${workspace.pages[0].id}`,
    );
    // One page is all pages; the picker would only repeat it.
    expect(screen.queryByRole("combobox", { name: "Pages" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Filter by date" }),
    ).toBeVisible();
    unmount();
    // A page the Audit no longer has stays visible, so the filter can be cleared.
    renderWorkspace(workspace, "?pageId=removed-page");
    expect(screen.getByRole("combobox", { name: "Pages" })).toBeVisible();
  });

  it("puts the page filter in the header line of every tab, and its first choice counts the Audit's pages", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      label: "Blog",
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    workspace.metrics = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const traffic = renderWorkspace(workspace, "tab=traffic");
    // No statistics for all pages: one page can still have them, so the filter stays.
    // The count is the filter: no labelled row of its own.
    expect(screen.getByRole("combobox", { name: "Pages" })).toHaveTextContent(
      "All 2 pages",
    );
    expect(screen.queryByText("2 pages")).toBeNull();
    traffic.unmount();
    // One page in view: the first choice still counts every page of the Audit.
    workspace.scope.pageIds = [workspace.pages[0].id];
    renderWorkspace(workspace, `tab=health&pageId=${workspace.pages[0].id}`);
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    expect(
      screen.getByRole("option", { name: "All 2 pages" }),
    ).toBeInTheDocument();
  });

  it("opens what happened at a stop of the runs row: counts on hover, every event in its details", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    const check = (id: string, day: number, issues: number) => ({
      id,
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date(Date.UTC(2026, 0, day, 12)),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: `${id}-task`,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "html-v1",
      artifactHash: id,
      issues,
      coverage: { checked: 2, skipped: 0, failed: 0 },
    });
    workspace.observations = [check("newest", 5, 2), check("oldest", 3, 1)];
    workspace.timeline = [
      ...workspace.observations.map((observation) => ({
        id: `${observation.id}-event`,
        kind: "check" as const,
        title: "SEO check results imported",
        status: "completed",
        detail: "",
        at: observation.observedAt,
        pageIds: observation.pageIds,
        taskId: observation.sourceTaskId,
        observationId: observation.id,
      })),
      // Between the two checks: the stop of the newer check holds it.
      {
        id: "page-change",
        kind: "page_change" as const,
        title: "Title changed",
        status: "recorded",
        detail: "",
        at: new Date(Date.UTC(2026, 0, 4, 12)),
        pageIds: workspace.scope.pageIds,
        taskId: null,
        observationId: null,
      },
      // After the newest check: its stop has no end.
      {
        id: "later-change",
        kind: "page_change" as const,
        title: "Description changed",
        status: "recorded",
        detail: "",
        at: new Date(Date.UTC(2026, 0, 6, 12)),
        pageIds: workspace.scope.pageIds,
        taskId: null,
        observationId: null,
      },
    ];
    workspace.runs = runsOf(workspace);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    await user.hover(await screen.findByRole("button", { name: /^Jan 5/ }));
    expect(await screen.findByText("1 check, 2 page changes")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("What happened after Jan 3."),
    ).toBeVisible();
    expect(within(dialog).getByText("Title changed")).toBeVisible();
    expect(within(dialog).getByText("Description changed")).toBeVisible();
    // The older check is its own stop's.
    expect(
      within(dialog)
        .getAllByRole("link", { name: /View results$/ })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/tasks/newest-task"]);
    // The dialog has no trigger: focus goes back to the stop the card came from.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Jan 5/ })).toHaveFocus(),
    );
    // Focus opens no card: the card is out of the keyboard's reach, and a tap on a phone focuses the stop.
    act(() => screen.getByRole("button", { name: /^Jan 3/ }).focus());
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      screen.queryByText("Show the check from Jan 3", { ignore: "[hidden]" }),
    ).toBeNull();
    // The way for the keyboard: the footer opens the details of the day in view, and focus comes back to it.
    const footerDetails = screen.getByRole("button", {
      name: "Details of Jan 5",
    });
    expect(footerDetails.closest("footer")).toContainElement(
      screen.getByRole("button", { name: "Other dates" }),
    );
    await user.click(footerDetails);
    expect(await screen.findByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(footerDetails).toHaveFocus());
    // A stop not in view says what a press does: to the keyboard as its description, and in its card.
    expect(
      screen.getByRole("button", { name: /^Jan 3/ }),
    ).toHaveAccessibleDescription("Show the check from Jan 3");
    await user.hover(screen.getByRole("button", { name: /^Jan 3/ }));
    expect(
      await screen.findByText("Show the check from Jan 3", {
        ignore: "[hidden]",
      }),
    ).toBeVisible();
  });

  it("opens every event of a range set in the calendar from the footer", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    workspace.observations = [
      {
        ...seoTestObservation(workspace),
        observedAt: new Date(Date.UTC(2026, 0, 5, 12)),
      },
    ];
    workspace.timeline = [
      {
        id: "page-change",
        kind: "page_change",
        title: "Title changed",
        status: "recorded",
        detail: "",
        at: new Date(Date.UTC(2026, 0, 4, 12)),
        pageIds: workspace.scope.pageIds,
        taskId: null,
        observationId: null,
      },
    ];
    workspace.runs = runsOf(workspace);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health&from=2026-01-01");
    await user.click(await screen.findByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Details" }),
    ).toBeVisible();
    expect(within(dialog).getByText("Title changed")).toBeVisible();
    expect(within(dialog).getByText(/^Showing Jan 1/)).toBeVisible();
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
      workspace.runs = runsOf(workspace);
      renderWorkspace(workspace, "?tab=health");
      // The day's details carry the coverage of a check with a Timeline row; a second list would repeat it.
      expect(
        screen.queryByRole("heading", {
          name: "Page details",
        }) !== null,
      ).toBe(!onTimeline);
      if (onTimeline)
        fireEvent.click(screen.getByRole("button", { name: /^Details of / }));
      expect(
        screen.getByText(
          onTimeline
            ? // The facts are spans of one line; the dot between them is a mark, with no space in the text.
              (_, node) =>
                node?.tagName === "P" &&
                /^2 tests·.*·1 test gave no result$/.test(
                  node.textContent ?? "",
                )
            : "Tests: 2 with a result, 1 without a result, 0 unavailable",
        ),
      ).toBeInTheDocument();
    },
  );

  it("names a Health page row without a name of its own only when it is the home page", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    // A page added without a name has its address as its label.
    workspace.pages[0].label = workspace.pages[0].url;
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "https://example.com/blog",
      relationship: "related",
    });
    // The root of another site is not the home page of this one.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://other.example/",
      label: "https://other.example/",
      relationship: "related",
    });
    workspace.timeline = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    // The home page has the word the issue rows use, and its address under it.
    const home = screen.getByRole("heading", { level: 3, name: "Home page" });
    const homeRow = home.closest("li");
    if (!homeRow) throw new Error("Home page row missing");
    expect(
      within(homeRow).getByRole("link", { name: "https://example.com/" }),
    ).toBeVisible();
    // Another page has no made-up name: its address is its first line.
    const blogRow = screen
      .getByRole("link", { name: "https://example.com/blog" })
      .closest("li");
    if (!blogRow) throw new Error("Blog row missing");
    expect(within(blogRow).queryByRole("heading")).toBeNull();
  });

  it("dates a Health issue row only when its finding is of another day than the tests tile", () => {
    const workspace = seoTestWorkspace();
    const finding = {
      id: "price",
      observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
      pageUrl: workspace.pages[0].url,
      device: "mobile" as const,
      rowId: "SD-08",
      title: "Markup matches the visible page",
      severity: "major" as const,
      evidence: ["The markup says 6.99, the page shows 9.99."],
      sourceRef: "html:head",
      // A row can carry a later time than its check (one read per device): the day of the check counts.
      observedAt: new Date("2026-01-04T12:00:00Z"),
    };
    workspace.findings.push(finding, {
      ...finding,
      id: "older",
      observationId: "older-check",
      rowId: "SD-09",
      title: "Older finding",
      observedAt: new Date("2026-01-02T12:00:00Z"),
    });
    // Newest first: the tile dates the check of Jan 3.
    workspace.observations = [
      { id: finding.observationId, day: 3 },
      { id: "older-check", day: 2 },
    ].map(({ id, day }) => ({
      id,
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date(Date.UTC(2026, 0, day, 12)),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "check-task",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile" as const],
      rulebookVersion: "html-v1",
      artifactHash: `hash-${day}`,
      issues: 1,
      coverage: {
        checked: 2,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 0 },
      },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "Last check Jan 3, 2026",
    );
    // The finding of the tile's day repeats no date. The older one has its date, with a word that names it.
    const dated = screen.getAllByText("Checked");
    expect(dated).toHaveLength(1);
    expect(dated[0].closest("li")).toHaveTextContent("Older finding");
    // The day alone, as in the tile: the rule compares days.
    expect(dated[0]).toHaveTextContent(
      /^Checked Jan 2, 2026(, View results)?$/,
    );
  });

  it("dates a Health page row only when its check is of another day than the tests tile", () => {
    const workspace = seoTestWorkspace();
    workspace.findings = [];
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/blog",
      label: "Blog",
    });
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/guide",
      label: "Guide",
    });
    const [home, blog, guide] = workspace.pages.map((page) => page.id);
    workspace.scope.pageIds = [home, blog, guide];
    // Newest first: the last check read the home page alone; the guide's last check is of the same day, hours
    // before; the blog's last check is of the day before. Each check has results of its own.
    workspace.observations = [
      { day: 4, hour: 15, pageIds: [home] },
      { day: 4, hour: 9, pageIds: [home, guide] },
      { day: 3, hour: 12, pageIds: [home, blog, guide] },
    ].map(({ day, hour, pageIds }) => ({
      id: `check-${day}-${hour}`,
      kind: "page_check" as const,
      source: "seo_coworker" as const,
      observedAt: new Date(Date.UTC(2026, 0, day, hour)),
      pageIds,
      scopeVersion: 2,
      sourceTaskId: `task-${day}-${hour}`,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop" as const],
      rulebookVersion: "html-v1",
      artifactHash: `hash-${day}-${hour}`,
      issues: 0,
      coverage: {
        checked: 2,
        skipped: 0,
        failed: 0,
        modules: { notRequested: 0, failed: 0 },
      },
    }));
    workspace.timeline = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    expect(screen.getByTestId("seo-summary-tests")).toHaveTextContent(
      "Last check Jan 4, 2026",
    );
    // The date of the tile is the one link to the results of its check. The words before it are text:
    // one underlined piece, also where the line breaks before the date.
    const dated = within(screen.getByTestId("seo-summary-tests")).getAllByRole(
      "link",
    );
    expect(dated).toHaveLength(1);
    // The words before the date are no part of the link.
    expect(dated[0]).toHaveAccessibleName(/^Jan 4, 2026\b.*View results$/);
    expect(dated[0]).toHaveAttribute("href", "/tasks/task-4-15");
    // A page row of that day repeats no date.
    expect(
      screen.queryByRole("link", { name: /^Last check Jan 4, 2026/ }),
    ).toBeNull();
    // The home page's check is the one the tile dates: its row shows the result as text. An underlined count
    // reads as "show these issues", and the link under it opened the results the tile opens.
    // The guide's check is another one of the same day: its row links the result, and repeats no date.
    const results = screen.getAllByRole("link", { name: /^no issues\b/ });
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveAttribute("href", "/tasks/task-4-9");
    expect(
      screen
        .getAllByText("no issues")
        .filter((element) => element.tagName !== "A"),
    ).toHaveLength(1);
    // The blog's check is older: its row keeps the date, and the date is the link.
    expect(
      screen.getByRole("link", { name: /^Last check Jan 3, 2026/ }),
    ).toBeVisible();
  });

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
    // A home page without a name of its own has the name its own row has.
    { label: "", expected: "Related to: Home page" },
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
      // A second primary page makes the parent a fact: the badge marks the page, the line names the parent.
      workspace.pages.push({
        ...workspace.pages[0],
        id: crypto.randomUUID(),
        url: "https://example.com/shop",
        label: "Shop",
      });
      workspace.scope.pageIds = workspace.pages.map((page) => page.id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace, "tab=health");
      const row = screen.getByRole("heading", { name: "Blog" }).closest("li");
      if (!row) throw new Error("Related page row missing");
      expect(within(row).getByText("Related page")).toBeVisible();
      expect(within(row).getByText(expected)).toBeVisible();
    },
  );

  it("shows search totals on a page only while the saved statistics cover that page alone", () => {
    const workspace = seoTestWorkspace();
    // A second page; the saved statistics still cover only the first.
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      label: "Blog",
    });
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
    const { unmount } = renderWorkspace(workspace, "tab=health");
    const row = screen.getByRole("heading", { name: "Home" }).closest("li");
    if (!row) throw new Error("Page row missing");
    expect(within(row).getByText("Search clicks")).toBeVisible();
    expect(within(row).getByText("7")).toBeVisible();
    // The same rate the Performance tiles show, as a percent.
    expect(within(row).getByText("5.7%")).toBeVisible();
    expect(within(row).getByText("Not checked yet")).toBeVisible();
    unmount();

    // A 1-page Audit shows these totals on Overview; the Pages tab does not repeat them.
    const one = seoTestWorkspace();
    one.metrics = [clicks];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(one)),
    );
    const single = renderWorkspace(one, "tab=health");
    // With one page the Timeline lists its checks; the page card does not repeat the last one.
    const onlyPage = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!onlyPage) throw new Error("Pages card missing");
    expect(
      within(onlyPage).queryByText(messages.App.Seo.pages.notChecked),
    ).toBeNull();
    expect(within(onlyPage).queryByText(/^Last check/)).toBeNull();
    expect(screen.queryByText("Search clicks")).toBeNull();
    single.unmount();

    // A lone page without its own name is the header's URL; the Pages card would only repeat it.
    const bare = seoTestWorkspace();
    bare.pages[0].label = bare.pages[0].url;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(bare)),
    );
    const plain = renderWorkspace(bare, "tab=health");
    const header = screen.getByRole("link", {
      name: "All audits",
    }).parentElement;
    if (!header) throw new Error("Header missing");
    expect(
      within(header).getByRole("link", { name: bare.pages[0].url }),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Pages" })).toBeNull();
    expect(screen.queryByText("1 page")).toBeNull();
    plain.unmount();
    // Without that page in view the header cannot name it, so the card stays.
    const empty = { ...bare, scope: { ...bare.scope, pageIds: [] } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(empty)),
    );
    const unscoped = renderWorkspace(empty, "tab=health");
    expect(screen.getByRole("heading", { name: "Pages" })).toBeVisible();
    unscoped.unmount();

    // A date filter keeps the page's own line: the Timeline does not say "in these dates".
    const filtered = seoTestWorkspace();
    filtered.pages[0].label = filtered.pages[0].url;
    filtered.scope.from = "2026-01-01";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(filtered)),
    );
    const dated = renderWorkspace(filtered, "tab=health&from=2026-01-01");
    const datedPage = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!datedPage) throw new Error("Pages card missing");
    expect(
      within(datedPage).getByText("No check in these dates"),
    ).toBeVisible();
    dated.unmount();

    const two = seoTestWorkspace();
    two.metrics = [clicks];
    two.pages.push({ ...two.pages[0], id: crypto.randomUUID(), label: "Blog" });
    two.scope.pageIds = two.pages.map((page) => page.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(two)),
    );
    const both = renderWorkspace(two, "tab=health");
    // Two pages in view: the header counts them, and the count is the page filter.
    expect(screen.getByRole("combobox", { name: "Pages" })).toHaveTextContent(
      "All 2 pages",
    );
    // Totals for two pages belong to neither page.
    expect(screen.queryByText("Search clicks")).toBeNull();
    both.unmount();
    // One page of two in view: the header names that page by its URL, not its name.
    const narrowed = {
      ...two,
      scope: { ...two.scope, pageIds: [two.pages[1].id] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(narrowed)),
    );
    renderWorkspace(narrowed, `tab=health&pageId=${two.pages[1].id}`);
    const narrowHeader = screen.getByRole("link", {
      name: "All audits",
    }).parentElement;
    if (!narrowHeader) throw new Error("Header missing");
    expect(
      within(narrowHeader).getByRole("link", { name: two.pages[1].url }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Pages" })[0]).toBeVisible();
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
    renderWorkspace(workspace, "tab=rankings");
    await user.click(screen.getByRole("button", { name: "Competitors" }));
    await user.click(
      screen.getByRole("button", {
        name: "Actions for https://rival.example/",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Compare with my page" }),
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
    renderWorkspace(workspace, "tab=health");
    const row = screen
      .getByRole("heading", { name: "Website and blog" })
      .closest("li");
    if (!row) throw new Error("Saved page selection missing");
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
    renderWorkspace(workspace, "?tab=traffic");
    // An arrow up beside a falling number reads as worse; the words carry it.
    const change = screen.getByText(/: 4\.0 · week before: 5\.0, better$/);
    expect(change.querySelector("svg")).toBeNull();
    // The line names the newest 7 days, so "week before" has a clear anchor.
    expect(change).toHaveTextContent(/^Oct 8\W+14:/);
    expect(screen.getByText(/: 140 · week before: 140$/)).toBeVisible();
  });

  it("reports no weekly position change when formatted values are equal", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from({ length: 14 }, (_, day) =>
      new Date(Date.UTC(2026, 9, day + 1)).toISOString().slice(0, 10),
    );
    const base = { ...seoTestMetric(), from: days[0], to: days[13] };
    workspace.metrics = [
      {
        ...base,
        id: "sync:impressions",
        key: "impressions",
        value: 1414,
        points: days.map((date) => ({ date, value: 101 })),
      },
      {
        ...base,
        id: "sync:position",
        key: "position",
        unit: "position",
        value: 3.825,
        points: days.map((date, day) => ({
          date,
          value: day < 7 ? 3.8 : 3.8499999999999996,
        })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText(/: 3\.8 · week before: 3\.8$/)).toBeVisible();
    expect(screen.queryByText(/week before: 3\.8, (better|worse)$/)).toBeNull();
  });

  it("marks a page change and a confirmed fix on the traffic chart and keys them", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from({ length: 14 }, (_, day) =>
      new Date(Date.UTC(2026, 9, day + 1)).toISOString().slice(0, 10),
    );
    workspace.metrics = [
      {
        id: "sync:clicks",
        key: "clicks",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        value: 14,
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt: new Date(),
        coverage: "complete",
        notes: [],
        points: days.map((date) => ({ date, value: 1 })),
      },
    ];
    workspace.timeline = [
      {
        id: "page-change:1",
        kind: "page_change",
        title: "New title",
        at: new Date("2026-10-05T09:00:00Z"),
        pageIds: [],
        observationId: null,
        taskId: null,
        status: "recorded",
        detail: "",
      },
    ];
    workspace.actions = [
      {
        id: "fix-title",
        observationId: "check-1",
        pageUrl: workspace.pages[0].url,
        findingIds: [],
        title: "Shorten the title",
        why: "",
        effort: "low",
        expectedEffect: "",
        edit: null,
        taskId: "task-1",
        status: "verified",
        completedAt: new Date("2026-10-07T09:00:00Z"),
        verifiedAt: new Date("2026-10-09T09:00:00Z"),
        kind: "fix",
        evidence: [],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    // The change, the Task's completion and the confirming check each mark their own day.
    expect(screen.getAllByTestId("seo-trend-change")).toHaveLength(3);
    expect(screen.getAllByTestId("seo-trend-marker")).toHaveLength(3);
    for (const kind of ["Page change", "Task done", "Fix confirmed"])
      expect(screen.getByText(kind)).toBeVisible();
    expect(screen.queryByText("Daily values")).toBeNull();
  });

  it("titles the daily clicks picture on the Agent tab", () => {
    const workspace = seoTestWorkspace();
    workspace.metricsStatus = "available";
    workspace.metrics = [
      {
        id: "sync:clicks",
        key: "clicks",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        value: 3,
        from: "2026-10-01",
        to: "2026-10-02",
        timeZone: "UTC",
        observedAt: new Date(),
        coverage: "complete",
        notes: [],
        points: [
          { date: "2026-10-01", value: 1 },
          { date: "2026-10-02", value: 2 },
        ],
      },
    ];
    // A saved check: the result card leads, not the setup card.
    workspace.observations.push({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-10-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=agent");
    // The picture says what it shows, as the keyword picture beside it does.
    expect(
      within(screen.getByTestId("seo-agent-graphics")).getByText(
        "Search clicks",
        { selector: "p" },
      ),
    ).toBeVisible();
  });

  it("shows the clicks and the keyword searches in one card that opens on the picture with data", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const observationId = "11111111-1111-4111-8111-111111111111";
    const clicks = (values: number[]): ProjectSeoWorkspace["metrics"] => [
      {
        id: "sync:clicks",
        key: "clicks",
        label: "",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        value: values.reduce((sum, value) => sum + value, 0),
        from: "2026-10-01",
        to: "2026-10-02",
        timeZone: "UTC",
        observedAt: new Date(),
        coverage: "complete",
        notes: [],
        points: values.map((value, day) => ({
          date: `2026-10-0${day + 1}`,
          value,
        })),
      },
    ];
    workspace.metricsStatus = "available";
    workspace.observations.push({
      id: observationId,
      kind: "page_check",
      source: "seo_coworker",
      observedAt: new Date("2026-10-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: null,
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 18,
      observedAt: new Date("2026-10-03T12:00:00Z"),
      observationId,
      position: null,
      positionStatus: "not_in_range",
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    workspace.keywords.push(
      { ...read, id: "small", keyword: "charge timer", volume: 90 },
      { ...read, id: "large", keyword: "battery app", volume: 720 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    // A site with clicks opens on the clicks; the switch leads to the keyword searches.
    workspace.metrics = clicks([1, 2]);
    renderWorkspace(workspace, "?tab=agent");
    const card = within(screen.getByTestId("seo-agent-graphics"));
    const switcher = card.getByRole("radiogroup", { name: "Picture to show" });
    // The keyword searches lead the switch.
    expect(
      within(switcher)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Keyword searches", "Search clicks"]);
    expect(
      within(switcher).getByRole("radio", { name: "Search clicks" }),
    ).toBeChecked();
    expect(card.queryByTestId("seo-demand-chart")).toBeNull();
    await user.click(
      within(switcher).getByRole("radio", { name: "Keyword searches" }),
    );
    expect(card.getByTestId("seo-demand-chart")).toBeVisible();
    expect(card.queryByTestId("seo-trend-bar")).toBeNull();
    cleanup();
    // No clicks yet: the card opens on the keyword searches.
    workspace.metrics = clicks([0, 0]);
    renderWorkspace(workspace, "?tab=agent");
    expect(
      within(screen.getByTestId("seo-agent-graphics")).getByRole("radio", {
        name: "Keyword searches",
      }),
    ).toBeChecked();
    expect(screen.getByTestId("seo-demand-chart")).toBeVisible();
    // Google Analytics has a slim line of its own at the top: its step is in no list of steps.
    expect(screen.getByTestId("seo-agent-statistics")).toHaveTextContent(
      /^Google statistics/,
    );
    expect(
      screen.queryByText(
        /Connect Google Analytics|Google Analytics is connected/,
      ),
    ).toBeNull();
    // A keyword of the picture opens the Rankings tab on that keyword.
    await user.click(
      within(screen.getByTestId("seo-demand-chart")).getByRole("button", {
        name: "battery app",
      }),
    );
    expect(screen.getByRole("tab", { name: "Rankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByDisplayValue("battery app")).toBeVisible();
    // A figure of the verdict counts every keyword, so it opens Rankings without that search.
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(
      within(screen.getByTestId("seo-agent-figures")).getByRole("button", {
        name: /keywords? found/,
      }),
    );
    expect(screen.queryByDisplayValue("battery app")).toBeNull();
  });

  it("names why the Google statistics line has no Analytics data, with the fix where one exists", async () => {
    const workspace = seoTestCheckedAudit();
    workspace.metrics = [seoTestMetric()];
    // Nothing else to propose: no competitor step, fresh search data. The tab must not be blank.
    workspace.metrics = workspace.metrics.map((metric) => ({
      ...metric,
      observedAt: new Date(),
    }));
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.searchQueries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt: new Date(),
      rowLimit: 250,
      truncated: false,
      rows: [],
    };
    const unrelated = [
      { id: "properties/1", name: "galaxy-balls" },
      { id: "properties/2", name: "roxtool" },
    ];
    // An expired connection reads as none. A connected account names its properties: none, none for the
    // site, one for the site whose sync runs or found nothing, a single other one that is read all the same, a
    // list that could not be read, or a connection that could not be read.
    for (const [status, properties, text, button] of [
      [
        "not_connected",
        unrelated,
        "Google statistics: Analytics not connected",
        /connect/i,
      ],
      [
        "needs_reconnect",
        unrelated,
        "Google statistics: Analytics not connected",
        /connect/i,
      ],
      // A connection whose approval did not finish keeps its button to start again.
      [
        "pending",
        unrelated,
        "Google statistics: Analytics not connected",
        "Start a new Google Analytics connection",
      ],
      // A connection that could not be read is a failed read: the upkeep line says it, with its Try again.
      [
        "unread",
        unrelated,
        "Google statistics could not load. Try again.",
        "Try again",
      ],
      [
        "connected",
        [],
        "Google statistics: this Google account has no Analytics property",
        "Google connections",
      ],
      [
        "connected",
        unrelated,
        "Google statistics: no Analytics property is picked for example.com. Choose one of your 2 properties.",
        "Choose property",
      ],
      [
        "connected",
        [...unrelated, { id: "properties/3", name: "example.com" }],
        "Google statistics: the Analytics property example.com has no visits for these pages yet",
        "Change property",
      ],
      // A sync that runs or failed is said once, by the upkeep line of the verdict card: the line steps aside.
      [
        "connected",
        [{ id: "properties/3", name: "example.com" }],
        "Loading Google statistics.",
        null,
      ],
      [
        "connected",
        [unrelated[0]],
        "Google statistics: the Analytics property galaxy-balls has no visits for these pages yet",
        "Google connections",
      ],
      [
        "connected",
        null,
        "Google statistics could not load. Try again.",
        "Try again",
      ],
    ] as const) {
      // The loading row's collection never finishes: "no visits" is what a finished collection found.
      const running = text === "Loading Google statistics.";
      const upkeep =
        running || text === "Google statistics could not load. Try again.";
      const fetch = vi.fn(async (url: string) =>
        url.endsWith("/connections/ga4")
          ? status === "unread"
            ? new Response(null, { status: 500 })
            : Response.json({
                provider: "ga4",
                name: "Google",
                status,
                source: "native",
              })
          : url.includes("/statistics/properties?provider=ga4")
            ? properties
              ? Response.json({
                  provider: "ga4",
                  properties,
                  status: "available",
                  reason: null,
                })
              : new Response(null, { status: 500 })
            : url.endsWith("/statistics")
              ? running
                ? new Promise<Response>(() => {})
                : Response.json({})
              : Response.json(workspace),
      );
      vi.stubGlobal("fetch", fetch);
      renderWorkspace(workspace, "?tab=agent");
      // The line can wait for a cause and come back: each read finds it again.
      const line = () => screen.getByTestId("seo-agent-statistics");
      if (upkeep) {
        const said = await screen.findByText(text);
        await waitFor(() =>
          expect(screen.queryByTestId("seo-agent-statistics")).toBeNull(),
        );
        // The upkeep line still waits on something: the tab does not say that nothing is waiting.
        expect(screen.queryByText(/^Nothing is waiting/)).toBeNull();
        if (button)
          expect(
            within(said.parentElement as HTMLElement).getByRole("button", {
              name: button,
            }),
          ).toBeVisible();
        cleanup();
        continue;
      }
      await waitFor(() => expect(line()).toHaveTextContent(text));
      if (button)
        expect(
          await within(line()).findByRole("button", { name: button }),
        ).toBeVisible();
      else expect(within(line()).queryByRole("button")).toBeNull();
      cleanup();
    }
    // A connected account with no cause to name has no bare line: here the property list says the connection
    // is gone while the connection still reads as connected.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/connections/ga4")
          ? Response.json({
              provider: "ga4",
              name: "Google",
              status: "connected",
              source: "native",
            })
          : url.includes("/statistics/properties?provider=ga4")
            ? Response.json({
                provider: "ga4",
                properties: [],
                status: "not_connected",
                reason: null,
              })
            : Response.json(workspace),
      ),
    );
    renderWorkspace(workspace, "?tab=agent");
    await waitFor(() =>
      expect(screen.queryByTestId("seo-agent-statistics")).toBeNull(),
    );
    // A hidden line with no upkeep message leaves the tab to say so: it is not blank.
    expect(
      await screen.findByText(
        "Nothing is waiting. Google statistics load automatically for the selected pages and refresh when needed.",
      ),
    ).toBeVisible();
    cleanup();
    // A connection not read yet: the line shows its connect button, so something is waiting.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/connections/ga4")
          ? new Promise<Response>(() => {})
          : Response.json(workspace),
      ),
    );
    renderWorkspace(workspace, "?tab=agent");
    expect(
      await screen.findByTestId("seo-agent-statistics"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing is waiting/)).toBeNull();
  });

  it("says whether Google indexes the page in view and names another canonical", async () => {
    const workspace = seoTestWorkspace();
    const url = workspace.pages[0].url;
    // A second page in view that no sync could inspect.
    workspace.pages.push({
      ...workspace.pages[0],
      id: "7b0c4f5e-1d2a-4c3b-9e8f-000000000002",
      url: `${url}blog`,
      relationship: "related",
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    const checkedAt = new Date("2026-11-01T10:00:00Z");
    workspace.indexStatus = {
      pages: [
        {
          pageUrl: url,
          verdict: "NEUTRAL",
          coverageState: "Alternate page with proper canonical tag",
          robotsTxtState: "ALLOWED",
          lastCrawlTime: new Date("2026-10-30T08:15:00Z"),
          googleCanonical: "https://example.com/other",
          userCanonical: null,
          checkedAt,
        },
        // A page outside the scope stays out of view.
        {
          pageUrl: "https://elsewhere.example/",
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          robotsTxtState: null,
          lastCrawlTime: null,
          googleCanonical: null,
          userCanonical: null,
          checkedAt,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    await userEvent.click(
      screen.getByText("Check details", { selector: "summary" }),
    );
    const section = screen
      .getByRole("heading", { name: "Google index" })
      .closest("section");
    if (!section) throw new Error("Index section missing");
    expect(within(section).getByText("Not indexed")).toBeVisible();
    expect(within(section).queryByText("Indexed")).toBeNull();
    expect(
      within(section).getByText(
        "Google: Alternate page with proper canonical tag",
      ),
    ).toBeVisible();
    expect(
      within(section).getByRole("link", { name: "https://example.com/other" }),
    ).toBeVisible();
    expect(
      within(section).getByText(/No index status yet for 1 page in view\./),
    ).toBeVisible();
  });

  it("includes Search Console indexing issues and their suggested fixes in the audit findings", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const pageUrl = workspace.pages[0].url;
    const relatedPageUrl = `${pageUrl}related`;
    const checkedAt = new Date("2026-11-16T08:00:00Z");
    const reason =
      "Google could not fetch this page, and the audit found a server error.";
    const suggestedFix =
      "Repair the server error, then check the page again before requesting a recrawl.";
    workspace.findings = [
      {
        id: "gsc-indexing-issue",
        relatedPageUrl,
        observationId: workspace.observations[0].id,
        pageUrl,
        device: null,
        rowId: "AC-20",
        title: "Google Search Console indexing",
        severity: "major",
        evidence: [reason, "Google says: Server error (5xx)."],
        suggestedFix,
        visibility: "PRIVATE",
        sourceRef: "seo-indexing:receipt",
        observedAt: checkedAt,
      },
      {
        id: "public-page-issue",
        observationId: workspace.observations[0].id,
        pageUrl,
        device: "mobile",
        rowId: "O-01",
        title: "Public page issue",
        severity: "minor",
        evidence: ["The public page is missing a description."],
        sourceRef: "public-page:receipt",
        observedAt: checkedAt,
      },
    ];
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt,
          pageUrl,
          status: "issue",
          report: true,
          reason,
          suggestedFix,
          evidence: ["Google says: Server error (5xx)."],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace, "?tab=actions");
    const findings = screen
      .getByRole("heading", { name: "Audit findings" })
      .closest("section");
    if (!findings) throw new Error("Audit findings section missing");
    const summary = within(findings)
      .getByText("Google Search Console indexing")
      .closest("summary");
    if (!summary) throw new Error("Indexing finding summary missing");
    expect(within(summary).getByText("/related")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Google index" })).toBeNull();
    await user.click(summary);
    expect(within(findings).getByText(reason)).toBeVisible();
    expect(
      within(findings).getByRole("link", { name: relatedPageUrl }),
    ).toHaveAttribute("href", relatedPageUrl);
    expect(workspace.pages).toHaveLength(1);
    expect(
      within(findings).getByText("Google says: Server error (5xx)."),
    ).toBeVisible();
    expect(within(findings).getByText("Suggested fix")).toBeVisible();
    expect(within(findings).getByText(suggestedFix)).toBeVisible();
    expect(
      within(findings).getByText("Only you can see this finding."),
    ).toBeVisible();
    const publicDetails = within(findings)
      .getByText("Public page issue")
      .closest("details");
    if (!publicDetails) throw new Error("Public finding details missing");
    expect(
      within(publicDetails).queryByText("Only you can see this finding."),
    ).toBeNull();
    expect(
      within(findings).queryByRole("button", { name: /create task/i }),
    ).toBeNull();
  });

  it("lists search totals by country and device, folding countries past ten", () => {
    const workspace = seoTestWorkspace();
    const row = (key: string, clicks: number) => ({
      key,
      clicks,
      impressions: clicks * 10,
      ctr: 0.1,
      averagePosition: 5.25,
    });
    const codes = [
      "DE",
      "AT",
      "CH",
      "US",
      "GB",
      "FR",
      "IT",
      "ES",
      "NL",
      "BE",
      "ZZZ",
    ];
    workspace.searchQueries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt: new Date(),
      rowLimit: 250,
      truncated: false,
      rows: [],
    };
    workspace.searchBreakdown = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      observedAt: new Date(),
      countries: {
        rowLimit: 250,
        truncated: false,
        rows: codes.map((code, index) => row(code, 20 - index)),
      },
      devices: { rowLimit: 250, truncated: false, rows: [row("mobile", 7)] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const section = screen
      .getByRole("heading", { name: "Countries and devices" })
      .closest("section");
    if (!section) throw new Error("Breakdown section missing");
    const country = within(section).getAllByRole("table")[0];
    expect(within(country).getByText("Germany")).toBeVisible();
    expect(within(country).getAllByRole("row")).toHaveLength(11);
    // The 11th country, Google's unknown region, folds into the count.
    expect(within(country).queryByText("Unknown country")).toBeNull();
    expect(
      within(section).getByText("1 more country with fewer clicks."),
    ).toBeVisible();
    const device = within(section).getAllByRole("table")[1];
    expect(within(device).getByText("Mobile")).toBeVisible();
    expect(within(device).getByText("5.3")).toBeVisible();
  });

  it("says once that both splits cover the same impressions", () => {
    const workspace = seoTestWorkspace();
    const observedAt = new Date("2026-10-29T00:00:00Z");
    const row = (key: string, impressions: number) => ({
      key,
      clicks: 0,
      impressions,
      ctr: 0,
      averagePosition: 3,
    });
    workspace.metrics = [
      {
        ...seoTestMetric(),
        id: "sync:impressions",
        key: "impressions",
        from: "2026-10-01",
        to: "2026-10-28",
        observedAt,
        value: 34,
      },
    ];
    const split = (impressions: number, key: string) => ({
      rowLimit: 250,
      truncated: false,
      rows: [row(key, impressions)],
    });
    const breakdown = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      observedAt,
      countries: split(1, "EG"),
      devices: split(1, "desktop"),
    };
    workspace.searchBreakdown = breakdown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const same = renderWorkspace(workspace, "?tab=traffic");
    expect(
      screen.getByText(
        "Google gives a country and a device for only 1 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Google gives a country for only/)).toBeNull();
    expect(screen.queryByText(/Google gives a device for only/)).toBeNull();
    same.unmount();
    // Different counts: each table says its own.
    breakdown.devices = split(5, "desktop");
    renderWorkspace(workspace, "?tab=traffic");
    expect(
      screen.getByText(
        "Google gives a country for only 1 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Google gives a device for only 5 of your 34 impressions.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/a country and a device/)).toBeNull();
  });

  it("names each total's change against the equal window before the period", () => {
    const workspace = seoTestWorkspace();
    const base = {
      label: "",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic" as const,
      from: "2026-10-01",
      to: "2026-10-14",
      timeZone: "UTC",
      observedAt: new Date(),
      coverage: "complete" as const,
      notes: [],
      points: [],
    };
    const before = (value: number) => ({
      from: "2026-09-17",
      to: "2026-09-30",
      value,
    });
    workspace.metrics = [
      {
        ...base,
        id: "s:clicks",
        key: "clicks",
        unit: "count",
        value: 30,
        previous: before(12),
      },
      {
        ...base,
        id: "s:impressions",
        key: "impressions",
        unit: "count",
        value: 900,
        previous: before(900),
      },
      {
        ...base,
        id: "s:position",
        key: "position",
        unit: "position",
        value: 4.2,
        previous: before(6.1),
      },
      {
        ...base,
        id: "s:ctr",
        key: "ctr",
        unit: "ratio",
        value: 0.025,
        previous: before(0.021),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText("Previous 14 days: 12 (+18)")).toBeVisible();
    expect(screen.getByText("Previous 14 days: 900, no change")).toBeVisible();
    // A lower position is better, so the words say it, not a sign.
    expect(screen.getByText("Previous 14 days: 6.1, better now")).toBeVisible();
    // A rate change carries its sign.
    expect(screen.getByText("Previous 14 days: 2.1% (+0.4 pp)")).toBeVisible();
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
    // A measured check with no issues.
    workspace.observations.push({
      id: crypto.randomUUID(),
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
      coverage: { checked: 2, skipped: 0, failed: 0 },
    });
    const { unmount } = renderWorkspace(workspace);
    // Fewer impressions than one week needs for a comparison: the verdict says Google rarely shows the page.
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "Your page passes the last check, but Google rarely shows it yet",
    );
    // The figure names the numbers; its period is part of its name.
    expect(
      screen.getByRole("button", {
        // The period is in the name only; a name joins its parts with a space.
        name: /^2 clicks · 35 impressions ?, Jan 1\W+2, 2026$/,
      }),
    ).toHaveAttribute("data-testid", "seo-agent-traffic");
    unmount();
    // Without clicks the line would read as zero clicks; it stays away.
    workspace.metrics = [impressions];
    const second = renderWorkspace(workspace);
    expect(screen.queryByTestId("seo-agent-traffic")).toBeNull();
    second.unmount();
    // Enough impressions for a week's comparison: the plain verdict.
    workspace.metrics = [
      { ...impressions, value: 100 },
      { ...impressions, id: "sync:clicks", key: "clicks", value: 2 },
    ];
    renderWorkspace(workspace);
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      "No issues found in the last check",
    );
  });

  it("shows saved property totals on the Agent tab only in the full audit view", () => {
    const workspace = seoTestCheckedAudit();
    const taskId = "full-audit";
    workspace.observations[0] = {
      ...workspace.observations[0],
      kind: "audit_full",
      sourceTaskId: taskId,
    };
    workspace.auditSearchConsole = [
      {
        taskId,
        propertyId: "sc-domain:example.com",
        from: new Date("2025-10-01"),
        to: new Date("2025-12-31"),
        pageUrls: [workspace.pages[0].url],
        measuredPages: [],
        coverage: "complete",
        clicks: 0,
        impressions: 2,
        ctr: 0,
        averagePosition: 4,
        propertyTotals: {
          clicks: 9,
          impressions: 675,
          ctr: 9 / 675,
          averagePosition: 6.7,
        },
        opportunities: [],
        previous: null,
        queries: { rows: [], truncated: false },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const view = renderWorkspace(workspace);
    const title = "Web search performance for the entire property";
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText("675")).toBeVisible();
    view.unmount();
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}`);
    expect(screen.queryByRole("heading", { name: title })).toBeNull();
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
    renderWorkspace(workspace, "?tab=traffic");
    // One note under the tiles, not one per tile.
    expect(screen.queryByText("Not enough days to compare")).toBeNull();
    // Search Console is Google search only; the subtitle does not repeat it.
    expect(screen.queryByText(/Organic search/)).toBeNull();
    expect(screen.getAllByText(/Too few to compare weeks\.$/)).toHaveLength(1);
    // Both weeks are small: no tile compares, and the one note keeps both counts.
    expect(
      screen.getByText(
        /^Jan 8\W+14: 14 impressions\. Week before: 7\. Too few to compare weeks\.$/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/better|worse/)).toBeNull();
    expect(screen.queryByText(/· week before: /)).toBeNull();
    // The position hint describes its tile; in the name, "5" and "1" would read as one number.
    const positionTile = screen.getByRole("button", {
      description: "1 is the top result",
    });
    expect(positionTile).not.toHaveAccessibleName(/top result/);
  });

  it("keeps the arrow on a search count that collapses from a busy week", () => {
    const workspace = seoTestWorkspace();
    const days = Array.from(
      { length: 14 },
      (_, day) => `2026-01-${String(day + 1).padStart(2, "0")}`,
    );
    // One sync has one time: metrics of two times are two syncs, and only the newest shows.
    const observedAt = new Date();
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
        observedAt,
        coverage: "complete",
        notes: [],
        value: 4935,
        // 4,900 impressions, then 35: a page that dropped out of the results.
        points: days.map((date, day) => ({ date, value: day < 7 ? 700 : 5 })),
      },
      {
        id: "sync:position",
        key: "position",
        label: "",
        unit: "position",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        from: days[0],
        to: days[13],
        timeZone: "UTC",
        observedAt,
        coverage: "complete",
        notes: [],
        value: 4.5,
        points: days.map((date, day) => ({ date, value: day < 7 ? 5 : 4 })),
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=traffic");
    const count = screen.getByText(/: 35 · week before: 4,900$/);
    expect(count.querySelector("svg")).not.toBeNull();
    // 35 impressions cannot carry a position change; only the position note shows.
    expect(
      screen.getByText(
        "Too few impressions to compare weeks for average position.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/better|worse/)).toBeNull();
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
    renderWorkspace(workspace, "?tab=traffic");
    expect(screen.getByText("Page views")).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
    expect(screen.getByText("Active users")).toBeVisible();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
    // One fold on Traffic; without search queries it does not explain them.
    await user.click(screen.getByText("About this data"));
    expect(screen.getByText(/Europe\/Berlin/)).toBeVisible();
    expect(screen.queryByText(/not search volume/)).toBeNull();
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
    renderWorkspace(workspace, "?tab=traffic");
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
        if (String(input).includes("/api/seo/connections/search_console"))
          return Response.json({
            provider: "search_console",
            name: "Search Console",
            status: "connected",
            source: "native",
          });
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
      const search = within(dialog).getByRole("region", {
        name: "Search Console",
      });
      expect(await within(search).findByText("Example website")).toBeVisible();
      expect(
        within(search).queryByRole("combobox", { name: "Property" }),
      ).toBeNull();
      // The saved period is not offered again: every sync reads the same rolling days.
      expect(
        within(search).getByTestId("seo-statistics-reads-search_console"),
      ).toHaveTextContent("Reads the last 90 days of Google search data.");
      await user.click(
        within(dialog).getAllByRole("button", { name: "Close" })[0],
      );
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
    "keeps Audit activity dates ($from / $to) when a sync reads its own 90 days",
    async ({ query, from, to }) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      const statistics = vi.fn(async (_body: SyncProjectSeoStatisticsRequest) =>
        Response.json(null),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (init?.method === "POST" && String(url).endsWith("/statistics"))
            return statistics(JSON.parse(String(init.body)));
          if (String(url).includes("/connections/")) {
            const provider = String(url).split("/").at(-1);
            return Response.json({
              provider,
              name: provider,
              status: provider === "ga4" ? "connected" : "not_connected",
              source: "native",
            });
          }
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
      renderWorkspace(workspace, `tab=traffic&${query}`);
      await openStatisticsSetup(user);
      const dialog = screen.getByRole("dialog");
      // One property: it is chosen, and shown as a line.
      expect(await within(dialog).findByText("Example website")).toBeVisible();
      expect(
        within(dialog).queryByRole("button", { name: /sync/i }),
      ).toBeNull();
      // A new Google Analytics sync reads organic search, and the view follows it.
      // Automatic collection keeps the Audit filters and only refreshes its data.
      await waitFor(() => expect(statistics).toHaveBeenCalled());
      if (from) {
        expect(screen.getByLabelText(messages.App.Seo.dateFrom)).toHaveValue(
          from,
        );
        expect(screen.getByLabelText(messages.App.Seo.dateTo)).toHaveValue(to);
      } else {
        // Unset activity dates stay folded and unset.
        expect(screen.queryByLabelText(messages.App.Seo.dateFrom)).toBeNull();
      }
      expect(statistics).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "ga4",
          propertyId: "properties/123",
          channel: "organic",
          automatic: true,
        }),
      );
      // The period is the 90 complete days up to yesterday, whatever the Audit's dates are.
      const body = statistics.mock.calls[0][0];
      const day = 86_400_000;
      expect(body.to).toBe(
        new Date(Date.now() - day).toISOString().slice(0, 10),
      );
      expect((Date.parse(body.to) - Date.parse(body.from)) / day).toBe(89);
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
    renderWorkspace(workspace, "?tab=health");
    expect(
      screen.getByRole("heading", {
        name: "Issue: Previous page finding",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Pages" }));
    await user.click(screen.getByRole("option", { name: "Other page" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", {
          name: "Issue: Previous page finding",
        }),
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
    const view = renderWorkspace(workspace, "?tab=traffic");
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

  it("opens the first full audit automatically while the private brief is unavailable", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const read = vi.fn(async (url: string) =>
      url.includes("/brief")
        ? new Promise<Response>(() => {})
        : connectedSeoResponse(workspace, url),
    );
    vi.stubGlobal("fetch", read);
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    const setup = within(screen.getByTestId("seo-setup"));
    await readConnectedGoogle();
    expect(
      await setup.findByRole("button", { name: "Advanced" }),
    ).toBeVisible();
    expect(
      setup.queryByRole("combobox", {
        name: goalCopy.question,
      }),
    ).toBeNull();
    expect(read.mock.calls.some(([url]) => url.includes("/brief"))).toBe(false);

    await user.click(setup.getByRole("button", { name: "Run full audit" }));
    const review = within(await screen.findByRole("dialog"));
    expect(review.getByRole("button", { name: "Start check" })).toBeEnabled();
    expect(saveGoal).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();

    await user.click(review.getByRole("button", { name: "Start check" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
      "sharedBrief",
    );
    expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
      "setupGoal",
    );
    expect(
      read.mock.calls.some(([url]) => url.includes("/brief/suggestion")),
    ).toBe(false);
    expect(saveGoal).not.toHaveBeenCalled();
  });

  it("discards consent to an old revision while its full-audit review is open", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const page = workspace.pages[0];
    let brief = {
      revision: 2,
      pages: [{ pageId: page.id, action: "buy" }],
      followUps: [],
      priorities: [],
    };
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/brief")
        ? Response.json(brief)
        : connectedSeoResponse(workspace, url),
    );
    const { client } = renderWorkspace(workspace);
    const setup = within(screen.getByTestId("seo-setup"));
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    await user.click(
      await setup.findByRole("combobox", { name: goalCopy.question }),
    );
    await user.click(await screen.findByRole("option", { name: "Read" }));
    await user.click(setup.getByRole("checkbox", { name: goalCopy.include }));
    await user.click(setup.getByRole("button", { name: "Run full audit" }));
    const review = within(await screen.findByRole("dialog"));
    expect(review.getByRole("checkbox", { name: /Read/ })).toBeChecked();
    await act(async () => {
      brief = {
        ...brief,
        revision: 3,
        pages: [{ pageId: page.id, action: "subscribe" }],
      };
      client.setQueryData(
        ["seo-brief", "owner", "org", "project", workspace.projectId],
        brief,
      );
    });
    expect(
      await review.findByRole("checkbox", { name: /Subscribe/ }),
    ).not.toBeChecked();
    await user.click(review.getByRole("button", { name: "Start check" }));
    expect(mutate).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(setup.getByRole("button", { name: "Run full audit" }));
    expect(
      within(await screen.findByRole("dialog")).getByRole("checkbox", {
        name: /Subscribe/,
      }),
    ).not.toBeChecked();
    expect(saveGoal).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each(["viewer", "session", "scope"] as const)(
    "discards the draft and consent when the %s changes during review",
    async (change) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      const first = workspace.pages[0];
      const other = {
        ...first,
        id: crypto.randomUUID(),
        url: new URL("/plans", first.url).href,
      };
      workspace.pages = [first, other];
      workspace.scope.pageIds = [first.id, other.id];
      const brief = { revision: 0, pages: [], followUps: [], priorities: [] };
      let current = workspace;
      vi.stubGlobal("fetch", async (url: string) =>
        url.endsWith("/brief")
          ? Response.json(brief)
          : connectedSeoResponse(current, url),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      const { client, refreshViewer } = renderWorkspace(workspace);
      const setup = within(screen.getByTestId("seo-setup"));
      await user.click(await setup.findByRole("button", { name: "Advanced" }));
      await user.click(
        await setup.findByRole("combobox", { name: goalCopy.question }),
      );
      await user.click(await screen.findByRole("option", { name: "Buy" }));
      await user.click(setup.getByRole("checkbox", { name: goalCopy.include }));
      await user.click(setup.getByRole("button", { name: "Run full audit" }));
      expect(
        within(await screen.findByRole("dialog")).getByRole("checkbox", {
          name: /Buy/,
        }),
      ).toBeChecked();
      if (change === "viewer") {
        viewer.userId = "another-owner";
        refreshViewer();
      } else if (change === "session") {
        viewer.sessionId = "second-session";
        refreshViewer();
      } else {
        current = {
          ...workspace,
          scope: {
            ...workspace.scope,
            version: workspace.scope.version + 1,
            pageIds: [other.id, first.id],
          },
        };
        await act(async () => {
          client.setQueryData(
            [
              "seo-workspace",
              "org",
              "owner",
              "project",
              workspace.projectId,
              "",
            ],
            current,
          );
        });
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const currentSetup = within(await screen.findByTestId("seo-setup"));
      const advanced = await currentSetup.findByRole("button", {
        name: "Advanced",
      });
      expect(advanced).toHaveAttribute("aria-expanded", "false");
      await user.click(
        currentSetup.getByRole("button", { name: "Run full audit" }),
      );
      const review = within(await screen.findByRole("dialog"));
      expect(review.queryByRole("checkbox", { name: /Buy/ })).toBeNull();
      await user.click(review.getByRole("button", { name: "Start check" }));
      await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
      const body = mutate.mock.calls[0][0].command.body;
      expect(body).not.toHaveProperty("setupGoal");
      expect(body).not.toHaveProperty("sharedBrief");
      expect(saveGoal).not.toHaveBeenCalled();
    },
  );

  it("keeps a suggested goal local through cancel and sends one restartable request on final confirmation", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const pageId = workspace.scope.pageIds[0];
    const brief = {
      revision: 0,
      pages: [],
      constraints: "Keep the checkout",
      followUps: [],
      priorities: [],
    };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/brief/suggestion?"))
        return Response.json({ action: "buy" });
      if (url.endsWith("/brief")) return Response.json(brief);
      return connectedSeoResponse(workspace, url);
    });
    // The old two-step operation can complete here, so an early write is observed immediately.
    saveGoal.mockImplementation(async ({ body }) => ({
      ok: true,
      value: { ...brief, revision: 1, pages: body.pages },
    }));
    mutate
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    const setup = within(screen.getByTestId("seo-setup"));
    const advanced = await setup.findByRole("button", { name: "Advanced" });
    await user.click(advanced);
    const suggested = await setup.findByRole("button", {
      name: /Use suggested goal .*Buy/,
    });
    expect(setup.getByLabelText(goalCopy.question)).toHaveTextContent(
      goalCopy.autoOption,
    );
    await user.click(suggested);
    expect(setup.getByLabelText(goalCopy.question)).toHaveFocus();
    const share = setup.getByRole("checkbox", { name: goalCopy.include });
    expect(share).not.toBeChecked();
    await user.click(share);
    await user.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(setup.getByText("This audit will use “Buy”.")).toBeVisible();
    const run = setup.getByRole("button", { name: "Run full audit" });
    await user.click(run);
    expect(saveGoal).not.toHaveBeenCalled();
    const review = within(await screen.findByRole("dialog"));
    expect(review.getByRole("checkbox", { name: /Buy/ })).toBeChecked();
    expect(mutate).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(saveGoal).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();

    // Include the goal in this new review explicitly.
    await user.click(advanced);
    const selector = await setup.findByRole("combobox", {
      name: goalCopy.question,
    });
    expect(selector).toHaveTextContent("Buy");
    const include = setup.getByRole("checkbox", { name: goalCopy.include });
    expect(include).not.toBeChecked();
    await user.click(include);
    await user.click(run);
    const confirm = within(await screen.findByRole("dialog")).getByRole(
      "button",
      { name: "Start check" },
    );
    await user.click(confirm);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const first = mutate.mock.calls[0][0].command;
    expect(first.kind).toBe("request_analysis");
    expect(first.body.setupGoal).toEqual({
      pageId,
      expectedRevision: 0,
      action: "buy",
    });
    expect(first.body.sharedBrief).toEqual({ pageIds: [pageId], revision: 0 });
    expect(JSON.stringify(first.body)).not.toContain(brief.constraints);
    await user.click(confirm);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1][0].command).toEqual(first);
    expect(saveGoal).not.toHaveBeenCalled();
  });

  it("clears the saved action only when the owner confirms a switch to Automatic", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const page = {
      pageId: workspace.pages[0].id,
      role: null,
      action: "buy",
      job: "Compare plans",
      indexIntent: "unknown",
    };
    const brief = { revision: 2, pages: [page], priorities: [], followUps: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/brief")
          ? Response.json(brief)
          : connectedSeoResponse(workspace, url),
      ),
    );
    saveGoal.mockImplementation(async ({ body }) => ({
      ok: true,
      value: { ...brief, revision: 3, pages: body.pages },
    }));
    renderWorkspace(workspace);
    const setup = within(screen.getByTestId("seo-setup"));
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    const action = await setup.findByRole("combobox", {
      name: goalCopy.question,
    });
    expect(action).toHaveTextContent("Buy");
    await user.click(action);
    await user.click(
      await screen.findByRole("option", { name: goalCopy.autoOption }),
    );
    await user.click(setup.getByRole("button", { name: "Run full audit" }));
    const review = within(await screen.findByRole("dialog"));
    expect(review.queryByRole("checkbox", { name: /Buy/ })).toBeNull();
    expect(saveGoal).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    mutate.mockResolvedValue({ ok: true, value: null });
    await user.click(review.getByRole("button", { name: "Start check" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const body = mutate.mock.calls[0][0].command.body;
    expect(body.setupGoal).toEqual({
      pageId: page.pageId,
      expectedRevision: 2,
      action: null,
    });
    expect(body).not.toHaveProperty("sharedBrief");
  });

  it.each([false, true])(
    "revokes public sharing for a changed goal while saving it in a full audit (share another page: %s)",
    async (shareOtherPage) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      const other = workspace.pages[0];
      const first = {
        ...other,
        id: "2e23a937-7bf7-47d7-bea9-4e055e339fc8",
        url: new URL("/plans", other.url).href,
      };
      // The workspace list is not the approved order of this scope.
      workspace.pages = [other, first];
      workspace.scope.pageIds = [first.id, other.id];
      const brief = {
        revision: 7,
        pages: [
          { pageId: other.id, action: "read" },
          { pageId: first.id, action: "buy" },
        ],
        followUps: [],
        priorities: [],
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.endsWith("/brief")
            ? Response.json(brief)
            : connectedSeoResponse(workspace, url),
        ),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace);
      const setup = within(screen.getByTestId("seo-setup"));
      await user.click(await setup.findByRole("button", { name: "Advanced" }));
      expect(await setup.findByText(first.url)).toBeVisible();
      expect(setup.getByLabelText(goalCopy.question)).toHaveTextContent("Buy");
      await user.click(setup.getByLabelText(goalCopy.question));
      await user.click(
        await screen.findByRole("option", { name: "Subscribe" }),
      );
      await user.click(setup.getByRole("checkbox", { name: goalCopy.include }));
      await user.click(setup.getByRole("button", { name: "Run full audit" }));
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByRole("checkbox", { name: /Read/ })).not.toBeChecked();
      const proposed = dialog.getByRole("checkbox", { name: /Subscribe/ });
      expect(proposed).toBeChecked();
      await user.click(proposed);
      if (shareOtherPage)
        await user.click(dialog.getByRole("checkbox", { name: /Read/ }));
      await user.click(dialog.getByRole("button", { name: "Start check" }));
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
      const body = mutate.mock.calls[0][0].command.body;
      if (shareOtherPage) {
        expect(body.sharedBrief).toEqual({ pageIds: [other.id], revision: 7 });
      } else {
        expect(body).not.toHaveProperty("sharedBrief");
      }
      expect(body.setupGoal).toEqual({
        pageId: first.id,
        expectedRevision: 7,
        action: "subscribe",
      });
      expect(saveGoal).not.toHaveBeenCalled();
    },
  );

  it("keeps the first review available when other pages already fill every private goal slot", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const brief = {
      revision: 4,
      pages: Array.from({ length: 10 }, () => ({
        pageId: crypto.randomUUID(),
        action: "buy",
      })),
      followUps: [],
      priorities: [],
    };
    const read = vi.fn(async (url: string) =>
      url.endsWith("/brief")
        ? Response.json(brief)
        : connectedSeoResponse(workspace, url),
    );
    vi.stubGlobal("fetch", read);
    const { client } = renderWorkspace(workspace);
    const setup = within(screen.getByTestId("seo-setup"));
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    await waitFor(() =>
      expect(
        client.getQueryData([
          "seo-brief",
          "owner",
          "org",
          "project",
          workspace.projectId,
        ]),
      ).toEqual(brief),
    );
    expect(setup.getByText(/Clear another page to add this one/)).toBeVisible();
    expect(setup.queryByLabelText(goalCopy.question)).toBeNull();
    expect(
      read.mock.calls.some(([url]) => url.includes("/brief/suggestion")),
    ).toBe(false);
    await user.click(
      setup.getByRole("button", { name: messages.App.Seo.brief.edit }),
    );
    expect(
      await screen.findByRole("dialog", { name: messages.App.Seo.brief.title }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(setup.getByRole("button", { name: "Run full audit" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(saveGoal).not.toHaveBeenCalled();
  });

  it("saves a manual first-page goal without Google or a suggestion and sends a free check without private context", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    const brief = {
      revision: 0,
      pages: [],
      updatedAt: null,
      audience: null,
      constraints: null,
      objective: null,
      outcome: null,
      followUps: [],
      priorities: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/brief/suggestion?"))
          return new Response(null, { status: 503 });
        if (url.endsWith("/brief")) return Response.json(brief);
        if (url.startsWith("/api/seo/connections/"))
          return Response.json({
            provider: "search_console",
            name: "Google",
            status: "disconnected",
            source: "native",
          });
        return Response.json(workspace);
      }),
    );
    saveGoal.mockImplementation(async ({ body }) => ({
      ok: true,
      value: { ...brief, revision: 1, pages: body.pages },
    }));
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(
      await screen.findByRole("button", { name: "Continue without Google" }),
    );
    const setup = within(screen.getByTestId("seo-setup"));
    expect(
      setup.queryByText("The audit detects the page goal from its content."),
    ).toBeNull();
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    expect(
      setup.queryByText("The audit detects the page goal from its content."),
    ).toBeNull();
    await user.click(
      await setup.findByRole("combobox", {
        name: goalCopy.question,
      }),
    );
    await user.click(await screen.findByRole("option", { name: "Read" }));
    expect(
      setup.queryByRole("checkbox", { name: goalCopy.include }),
    ).toBeNull();
    await user.click(setup.getByRole("button", { name: "Run page check" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(saveGoal).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(
      dialog.queryByText("Share page goals in this public task"),
    ).toBeNull();
    await user.click(dialog.getByRole("button", { name: "Start check" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].command.body.kind).toBe("page_check");
    expect(mutate.mock.calls[0][0].command.body.setupGoal).toEqual({
      pageId: workspace.scope.pageIds[0],
      expectedRevision: 0,
      action: "read",
    });
    expect(mutate.mock.calls[0][0].command.body).not.toHaveProperty(
      "sharedBrief",
    );
  });

  it("starts a native HTML check without a prior import or caller-selected executor", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await readConnectedGoogle();
    await user.click(screen.getByRole("button", { name: "Run full audit" }));
    const dialog = screen.getByRole("dialog");
    await openCheckOptions(user);
    // The dialog opens on the full audit; the page check is one choice away.
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Page check" }));
    expect(within(dialog).queryByLabelText("Maximum data requests")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: /coworker/i }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
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
        vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
      );
      mutate.mockResolvedValue({ ok: true, value: null });
      renderWorkspace(workspace);
      await readConnectedGoogle();
      await user.click(screen.getByRole("button", { name: "Run page check" }));
      const dialog = screen.getByRole("dialog");
      await openCheckOptions(user);
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
      await user.clear(within(dialog).getByLabelText("Search language"));
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

  it("shows a price in credits only when Audit lite includes provider-backed checks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace);
    await readConnectedGoogle();
    await user.click(screen.getByRole("button", { name: "Run full audit" }));
    const dialog = screen.getByRole("dialog");
    await openCheckOptions(user);
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    await user.click(screen.getByRole("option", { name: "Audit lite" }));
    const price = /^Up to \d+ credits?$/;
    expect(within(dialog).queryByText(price)).toBeNull();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).getByText(price)).toBeVisible();
    await user.click(within(dialog).getByLabelText("Backlink overview"));
    expect(within(dialog).queryByText(price)).toBeNull();
    // No limit field: the check asks for the requests it makes.
    expect(within(dialog).queryByRole("spinbutton")).toBeNull();
  });

  it("keeps an Advanced choice as a local draft while the workspace has no SEO worker", async () => {
    const user = userEvent.setup();
    vi.spyOn(publicEnv, "getEnvPublicConfig").mockReturnValue({
      ...publicEnv.getEnvPublicConfig(),
      NEXT_PUBLIC_VERCEL_ENV: "production",
    });
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.availableActions.canCreateMonitor = false;
    const brief = {
      revision: 1,
      pages: [],
      constraints: "Leave the cart as it is",
      audience: null,
      objective: null,
      outcome: null,
      followUps: [],
      priorities: [],
    };
    const read = vi.fn(async (url: string) => {
      if (url.endsWith("/brief")) return Response.json(brief);
      if (url.includes("/brief/suggestion"))
        return Response.json({ action: null });
      return connectedSeoResponse(workspace, url);
    });
    vi.stubGlobal("fetch", read);
    renderWorkspace(workspace);
    await readConnectedGoogle();
    const setup = within(screen.getByTestId("seo-setup"));
    expect(read.mock.calls.some(([url]) => url.includes("/brief"))).toBe(false);
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    const action = await setup.findByRole("combobox", {
      name: goalCopy.question,
    });
    expect(setup.queryByRole("button", { name: "Save page goal" })).toBeNull();
    expect(action).toHaveTextContent(goalCopy.autoOption);
    expect(
      setup.getByRole("button", { name: "Start audit" }),
    ).toHaveAccessibleDescription(
      "This workspace has no available SEO worker to run a check. Google statistics still work.",
    );
    await user.click(action);
    await user.click(await screen.findByRole("option", { name: "Buy" }));
    expect(setup.getByText(goalCopy.pausedDraft)).toBeVisible();
    expect(
      setup.queryByRole("checkbox", { name: goalCopy.include }),
    ).toBeNull();
    expect(saveGoal).not.toHaveBeenCalled();
    expect(setup.queryByRole("button", { name: "Save page goal" })).toBeNull();
    const advanced = setup.getByRole("button", { name: "Advanced" });
    await user.click(advanced);
    await user.click(advanced);
    expect(
      setup.getByRole("combobox", { name: goalCopy.question }),
    ).toHaveTextContent("Buy");
    expect(setup.getByRole("button", { name: "Start audit" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("retries a failed private goal read inside paused setup", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    const briefRead = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ revision: 0, pages: [] }));
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/brief")) return briefRead();
      if (url.includes("/brief/suggestion"))
        return Response.json({ action: null });
      return connectedSeoResponse(workspace, url);
    });
    renderWorkspace(workspace);
    await readConnectedGoogle();
    const setup = within(screen.getByTestId("seo-setup"));
    await user.click(await setup.findByRole("button", { name: "Advanced" }));
    expect(
      await setup.findByText(messages.App.Seo.brief.readFailed),
    ).toBeVisible();
    await user.click(
      setup.getByRole("button", { name: messages.App.Seo.brief.retry }),
    );
    expect(
      await setup.findByRole("combobox", {
        name: goalCopy.question,
      }),
    ).toHaveTextContent(goalCopy.autoOption);
    expect(briefRead).toHaveBeenCalledTimes(2);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("explains the disabled first check on hover and keeps recovery inside SEO", async () => {
    const user = userEvent.setup();
    vi.spyOn(publicEnv, "getEnvPublicConfig").mockReturnValue({
      ...publicEnv.getEnvPublicConfig(),
      NEXT_PUBLIC_VERCEL_ENV: "preview",
    });
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    workspace.availableActions.canUsePaidSearchData = false;
    workspace.availableActions.canCreateMonitor = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace);
    await readConnectedGoogle();
    const setup = within(screen.getByTestId("seo-setup"));
    const run = setup.getByRole("button", { name: "Start audit" });
    const reason =
      "This preview has no SEO worker available for this workspace. Google statistics still work.";
    expect(run).toBeVisible();
    expect(run).toHaveAttribute("aria-disabled", "true");
    expect(run).toHaveAccessibleDescription(reason);
    expect(setup.getByText(reason)).toBeVisible();
    act(() => {
      setup.getByRole("button", { name: "Advanced" }).focus();
    });
    await user.tab();
    expect(run).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.tab();
    await user.hover(run);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
    await user.unhover(run);
    await user.click(run);
    expect(run).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
    // "All audits" goes back to the Audit's Project scope.
    expect(screen.getByRole("link", { name: "All audits" })).toHaveAttribute(
      "href",
      `/seo?projectId=${SEO_TEST_PROJECT}`,
    );
    expect(
      screen.queryByRole("link", { name: /bot|coworker|assistant/i }),
    ).toBeNull();
    // Report import is gone: adding a page is the first step without checks.
    expect(screen.queryByRole("button", { name: /import/i })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await user.click(screen.getAllByRole("button", { name: "Add a page" })[0]);
    const addPage = screen.getByRole("dialog", { name: "Add a page" });
    expect(addPage).toBeVisible();
    // A new page relates to the main page unless the user says it stands alone.
    expect(
      within(addPage).getByRole("combobox", { name: "Related to" }),
    ).toHaveTextContent(workspace.pages[0].label || workspace.pages[0].url);
    // With no pages the card is back: the page step has the one button, and the check waits as a title.
    cleanup();
    workspace.scope.pageIds = [];
    renderWorkspace(workspace);
    expect(
      within(screen.getByTestId("seo-setup"))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Add a page"]);
  });

  it("leads a new audit with its setup steps and shows a check in flight", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace);
    await readConnectedGoogle();
    const setup = screen.getByRole("region", { name: "Set up this audit" });
    const steps = within(
      within(setup).getByRole("list", { name: "Setup steps" }),
    ).getAllByRole("listitem");
    // The page is saved, so the first audit is the current step.
    expect(steps.map((step) => step.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "step",
    ]);
    // The schedule offer and the old verdict wait until a check exists.
    expect(screen.queryByTestId("seo-automation")).toBeNull();
    expect(screen.queryByTestId("seo-agent-verdict")).toBeNull();
    await user.click(
      within(steps[2]).getByRole("button", { name: "Run full audit" }),
    );
    // The step's button opens the dialog on the check it names.
    expect(
      within(screen.getByTestId("seo-analysis-summary")).getByText(
        "Full audit",
      ),
    ).toBeVisible();
    cleanup();
    workspace.analyses = [
      {
        id: "8a0f4a39-7a55-4f0c-9a43-6c1a4f1f2b11",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date(),
      },
    ];
    renderWorkspace(workspace);
    await readConnectedGoogle();
    // The badge is the picture; the status line is what a screen reader hears.
    expect(
      within(screen.getByTestId("seo-setup")).getByRole("button", {
        name: "Check running",
      }),
    ).toBeVisible();
    expect(
      screen
        .getAllByRole("status")
        .some((status) => status.textContent === "Check running"),
    ).toBe(true);
    // The button stays for keyboard focus, but starts no second check.
    for (const again of screen.getAllByRole("button", {
      name: "Check running",
    })) {
      expect(again).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(again);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("schedules finite native monitoring with its market and per-run budget", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    // The Agent tab leads with its setup card before the first check; the other tabs hold the run.
    renderWorkspace(workspace, "?tab=traffic");
    await readConnectedGoogle();
    // The arrow of the run schedules the follow-up, also before the first check.
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    // The schedule repeats the full audit, the check of the run button.
    const summary = within(within(dialog).getByTestId("seo-analysis-summary"));
    expect(summary.getByText("Full audit")).toBeVisible();
    // No page picked reads as the words of the page picker, not "1 page · Pages".
    expect(summary.getByText("All pages")).toBeVisible();
    // The schedule opens weekly on Mondays at 09:00.
    expect(
      within(dialog).getByRole("button", { name: "Weekly" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Weekly or monthly is the whole choice: no daily, weekday, day-count or cron repeat (owner, after pass 59).
    for (const name of ["Daily", "Weekdays", "Every few days", "Custom"])
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Monthly" }),
    ).toHaveAttribute("aria-pressed", "false");
    await user.click(
      within(dialog).getByRole("button", { name: "Change options" }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    );
    // A schedule can repeat the full audit too.
    expect(screen.getByRole("option", { name: "Full audit" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
    await user.type(within(dialog).getByLabelText("Search language"), "de");
    await user.type(
      within(dialog).getByLabelText("Keywords, one per line"),
      "stablecoins",
    );
    // No weekday is no rule: the form refuses to save.
    await user.click(within(dialog).getByRole("button", { name: "Monday" }));
    const monitorForm = dialog.querySelector("form");
    if (!monitorForm) throw new Error("Missing monitor form");
    fireEvent.submit(monitorForm);
    expect(mutate).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Monday" }));
    fireEvent.change(
      within(dialog).getByLabelText("Ends", { selector: "input" }),
      { target: { value: "2" } },
    );
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
          rule: {
            expr: "0 9 * * MON",
            timezone: expect.any(String),
            intervalDays: null,
            anchorAt: null,
            endsMode: "AFTER",
            endsOn: null,
            targetRunCount: 2,
          },
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

  it("offers no schedule while the dates are wrong: the form could not open and would open later unasked", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    renderWorkspace(workspace, "?tab=traffic&from=2026-02-01&to=2026-01-01");
    await readConnectedGoogle();
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    expect(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it.each([false, undefined])(
    "keeps one-off checks available without an approved scheduler (%s)",
    async (permission) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      workspace.availableActions.canCreateMonitor = permission;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
      );
      const view = renderWorkspace(workspace);
      await readConnectedGoogle();
      expect(
        screen.getByRole("button", { name: "Run full audit" }),
      ).toBeVisible();
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
      await readConnectedGoogle();
      // No schedule exists here, so the schedule card stays away.
      expect(screen.queryByTestId("seo-automation")).toBeNull();
    },
  );

  it("blocks an open monitor form when scheduler readiness is withdrawn", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => connectedSeoResponse(workspace, url)),
    );
    const view = renderWorkspace(workspace, "?tab=traffic");
    await readConnectedGoogle();
    await user.click(
      screen.getByRole("button", { name: messages.App.Seo.monitor.create }),
    );
    await user.click(
      await screen.findByRole("menuitem", {
        name: messages.App.Seo.monitor.create,
      }),
    );
    const dialog = screen.getByRole("dialog");
    // Without paid search data the schedule form opens with a page check. Its fields are folded.
    await user.click(
      within(dialog).getByRole("button", { name: "Change options" }),
    );
    expect(
      within(dialog).getByRole("combobox", { name: "Check type" }),
    ).toHaveTextContent(messages.App.Seo.analysis.page_check);
    expect(
      within(dialog).getByText(messages.App.Seo.analysis.htmlService),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("combobox", { name: "Search country" }),
    );
    await user.click(screen.getByRole("option", { name: "DE" }));
    await user.clear(within(dialog).getByLabelText("Search language"));
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
    expect(screen.queryByText(messages.App.Seo.setup.title)).toBeNull();
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

  it("refreshes the visible private page priority after an automatic Search Console collection", async () => {
    const workspace = seoTestWorkspace();
    let collected = false;
    const gate = Promise.withResolvers<void>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.endsWith("/brief")) {
          return Response.json({
            revision: 2,
            pages: [],
            followUps: [],
            priorities: [
              {
                pageId: workspace.pages[0].id,
                why: [],
                nextStep: collected
                  ? "Review the new crawl."
                  : "Awaiting crawl evidence.",
              },
            ],
          });
        }
        if (url.pathname.includes("/connections/")) {
          const provider = url.pathname.split("/").at(-1);
          return Response.json({
            provider,
            name: provider,
            source: "native",
            status:
              provider === "search_console" ? "connected" : "not_connected",
          });
        }
        if (url.pathname.endsWith("statistics/properties"))
          return Response.json({
            provider: "search_console",
            status: "available",
            reason: null,
            properties: [
              { id: "sc-domain:example.com", name: "Website property" },
            ],
          });
        if (init?.method === "POST" && url.pathname.endsWith("/statistics")) {
          await gate.promise;
          collected = true;
          return Response.json(null);
        }
        return Response.json(workspace);
      }),
    );
    renderWorkspace(workspace, "?tab=actions");
    expect(await screen.findByText("Awaiting crawl evidence.")).toBeVisible();
    gate.resolve();
    expect(await screen.findByText("Review the new crawl.")).toBeVisible();
  });

  it("shows newly synced Search Console metrics under the organic filter", async () => {
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
    let collected = false;
    const statistics = vi.fn(async (_body: SyncProjectSeoStatisticsRequest) => {
      collected = true;
      return Response.json(null);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
          return statistics(JSON.parse(String(init.body)));
        if (url.pathname.endsWith("/statistics/traffic")) {
          const { propertyId, from, to } = JSON.parse(String(init?.body));
          return Response.json({
            propertyId,
            from,
            to,
            site: "example.com",
            totals: null,
            pages: [],
            limited: false,
          });
        }
        if (url.pathname.includes("/connections/")) {
          const provider = url.pathname.split("/").at(-1);
          return Response.json({
            provider,
            name: provider,
            status:
              provider === "search_console" ? "connected" : "not_connected",
            source: "native",
          });
        }
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
        return Response.json(collected ? measured : workspace);
      }),
    );
    renderWorkspace(workspace, "?tab=traffic&channel=organic");
    await waitFor(() => expect(statistics).toHaveBeenCalled());
    expect(statistics).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
        scopeId: workspace.scope.id,
        expectedScopeVersion: 2,
        automatic: true,
      }),
    );
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
                // Only Google Analytics has an account, so only its section reads properties.
                status: url.endsWith("/ga4") ? "connected" : "not_connected",
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
    expect(await screen.findByText("Current Google account")).toBeVisible();
    // The accounts are one card; its one menu holds the rare account actions per source.
    await userEvent.click(
      await screen.findByRole("button", { name: "Google account options" }),
    );
    // Only the connected source has actions.
    expect(
      screen.queryByRole("menuitem", { name: "Disconnect Search Console" }),
    ).toBeNull();
    // The question opens above the statistics dialog; Escape closes the question only.
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: "Disconnect Google Analytics",
      }),
    );
    expect(await screen.findByRole("alertdialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("Current Google account")).toBeVisible();
  });

  it("leads the chat examples with the question about Google's results when no keyword is in them", async () => {
    const user = userEvent.setup();
    const workspace = {
      ...seoTestWorkspace(),
      auditId: SEO_TEST_AUDIT,
      auditName: "Launch pages",
    };
    // One full audit read one keyword, and no page is in its results.
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 198, skipped: 0, failed: 0 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 100,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init?: RequestInit) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-agent-figures")).toHaveTextContent(
      /^0 of /,
    );
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    expect(
      await within(panel).findByRole("button", {
        name: "Why are my pages not in Google's top results?",
      }),
    ).toBeVisible();
    expect(
      within(panel).queryByRole("button", { name: "What should I do first?" }),
    ).toBeNull();
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
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=rankings`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    expect(within(panel).getByLabelText("Your question")).toBeVisible();
    expect(
      await within(panel).findByRole("button", {
        name: "What should I do first?",
      }),
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
    const workspace = { ...seoTestCheckedAudit(), auditName: "Launch pages" };
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
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByRole("button", {
        name: `Create draft task: ${opportunity.title}`,
      }),
    ).toBeVisible();
  });

  it("answers a question in the chat sheet, and keeps the thread there on other tabs", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    const reads = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method !== "POST") {
          reads();
          return Response.json({ sharing: "personal", turns });
        }
        const next = turn(JSON.parse(String(init.body)).question);
        turns.push(next);
        return Response.json(next);
      }),
    );
    renderWorkspace(workspace);
    // The Agent tab holds no thread and no field, and reads no chat before the sheet opens.
    await screen.findByTestId("seo-agent-verdict");
    expect(screen.queryByText("Earlier visit question")).toBeNull();
    expect(reads).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "New question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
    expect(
      await within(sheet).findByText("Answer to New question"),
    ).toBeVisible();
    expect(within(sheet).getByText("Earlier visit question")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("Answer to New question")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Answer to New question",
      ),
    ).toBeVisible();
  });

  it("runs the widest check the workspace allows from the header", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/chat")
          ? Response.json({ sharing: "personal", turns: [] })
          : connectedSeoResponse(workspace, url),
      ),
    );
    const checkType = () =>
      within(screen.getByRole("dialog")).getByRole("combobox", {
        name: "Check type",
      });
    // The setup card is on the Agent tab only: there its check step leads, on the other tabs the header does.
    renderWorkspace(workspace);
    await readConnectedGoogle();
    // One run button there: the card's. The header adds no second one.
    expect(
      within(await screen.findByTestId("seo-setup")).getByRole("button", {
        name: "Run full audit",
      }),
    ).toHaveClass("bg-primary");
    expect(
      screen.getAllByRole("button", { name: "Run full audit" }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    expect(
      await screen.findByRole("button", { name: "Run full audit" }),
    ).toHaveClass("bg-quaternary");
    cleanup();
    workspace.observations.push({
      id: "first-check",
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
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    for (const keyword of ["stablecoins", "stablecoin wallet"])
      workspace.keywords.push({
        id: keyword,
        keyword,
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
        difficulty: null,
        clicks: null,
        conversion: null,
        feature: null,
        device: null,
        position: null,
        positionStatus: "unavailable",
        checkedResults: null,
        observedAt: null,
        observationId: null,
      });
    renderWorkspace(workspace, "?tab=health");
    await readConnectedGoogle();
    await user.click(
      await screen.findByRole("button", { name: "Run full audit" }),
    );
    await openCheckOptions(user);
    expect(checkType()).toHaveTextContent("Full audit");
    expect(
      screen.getByText(
        "Also checks indexing for relevant pages from this site, up to 10 pages total. Full audits cover selected pages only.",
      ),
    ).toBeVisible();
    // A full audit takes one keyword, so the form does not open on a list it would refuse.
    const keywords = () => screen.getByLabelText("Keywords, one per line");
    expect(keywords()).toHaveValue("stablecoins");
    // Another check type takes the whole saved list again.
    await user.click(checkType());
    await user.click(screen.getByRole("option", { name: "Keyword positions" }));
    expect(
      screen.queryByText(
        "Also checks indexing for relevant pages from this site, up to 10 pages total. Full audits cover selected pages only.",
      ),
    ).toBeNull();
    expect(keywords()).toHaveValue("stablecoins\nstablecoin wallet");
    await user.click(checkType());
    await user.click(screen.getByRole("option", { name: "Full audit" }));
    expect(keywords()).toHaveValue("stablecoins");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();
    // Without paid search data a full audit cannot run: the button names the page check.
    workspace.availableActions.canUsePaidSearchData = false;
    renderWorkspace(workspace, "?tab=traffic");
    await readConnectedGoogle();
    await user.click(
      await screen.findByRole("button", { name: "Run page check" }),
    );
    await openCheckOptions(user);
    expect(checkType()).toHaveTextContent("Page check");
    cleanup();
    // While a check runs the button says so, keeps its place and opens nothing.
    workspace.analyses = [
      {
        id: "8a0f4a39-7a55-4f0c-9a43-6c1a4f1f2b11",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date(),
      },
    ];
    // Site health has one run control: the header's.
    renderWorkspace(workspace, "?tab=health");
    await readConnectedGoogle();
    expect(
      await screen.findByRole("button", { name: "Check running" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run a check" })).toBeNull();
    cleanup();
    renderWorkspace(workspace, "?tab=rankings");
    await readConnectedGoogle();
    const waiting = await screen.findByRole("button", {
      name: "Check running",
    });
    expect(waiting).toHaveAttribute("aria-disabled", "true");
    expect(waiting).not.toHaveClass("bg-primary");
    expect(screen.queryByRole("button", { name: "Run page check" })).toBeNull();
    await user.click(waiting);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    // With checks off the button points to the notice that says why.
    // Correction: unavailable run actions are now hidden; the notice explains the service state.
    workspace.analyses = [];
    workspace.availableActions.canRequestAnalysis = false;
    renderWorkspace(workspace, "?tab=rankings");
    await readConnectedGoogle();
    expect(screen.queryByRole("button", { name: "Run page check" })).toBeNull();
    expect(screen.getByText(messages.App.Seo.dispatchPaused)).toBeVisible();
    cleanup();
    // A reader who cannot edit has no run button, and no notice for it to point to.
    workspace.availableActions.canEdit = false;
    renderWorkspace(workspace, "?tab=rankings");
    await readConnectedGoogle();
    expect(await screen.findByRole("tab", { name: "Rankings" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run page check" })).toBeNull();
  });

  it("keeps an answer asked in the chat sheet on another tab in reach from the Agent tab", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    await within(sheet).findByText(messages.App.Seo.agent.prompts.first);
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "Sheet question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
    expect(
      await within(sheet).findByText("Answer to Sheet question"),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await within(await screen.findByRole("dialog")).findByText(
        "Answer to Sheet question",
      ),
    ).toBeVisible();
  });

  it("keeps an answer in view when the question is sent before chat history loads", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
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
    await user.click(
      await screen.findByRole("button", { name: "Ask the SEO agent" }),
    );
    const sheet = await screen.findByRole("dialog");
    await user.type(
      within(sheet).getByLabelText("Your question"),
      "Early question",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
    expect(
      await screen.findByText("Answer before history loaded"),
    ).toBeVisible();
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(screen.getByText("Answer before history loaded")).toBeVisible();
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
    renderWorkspace(workspace, "tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const panel = await screen.findByRole("dialog", {
      name: "Ask the SEO agent",
    });
    await within(panel).findByText(history.turns[0].response);
    expect(within(panel).getByText("Alex")).toBeVisible();
    expect(within(panel).getByText("You")).toBeVisible();
    expect(
      within(panel).getByText("Shared in your organization"),
    ).toBeVisible();
    expect(
      within(panel).getByRole("textbox", { name: "Your question" }),
    ).toHaveAccessibleDescription(
      "This conversation and saved statistics are shared within this audit in your organization.",
    );
    expect(within(panel).queryByText(/visible only to you/)).toBeNull();
  });

  it("opens a saved link to an old tab on the tab that now holds its content", async () => {
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=keywords");
    expect(
      await screen.findByRole("tab", { name: "Rankings", selected: true }),
    ).toBeVisible();
  });

  it("shows the site audit's keyword result on the Agent tab and its strategy actions as a step", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    workspace.actions = [];
    workspace.observations = [
      {
        id: seoTestStrategy().observationId,
        kind: "audit_full",
        source: "seo_coworker",
        observedAt: new Date("2026-11-11T00:26:00Z"),
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
        countryCode: "US",
        languageCode: "en",
        devices: ["mobile", "desktop"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 12, skipped: 0, failed: 0 },
      },
    ];
    workspace.strategy = seoTestStrategy();
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.endsWith("/chat")) return Response.json(workspace);
        if (init?.method === "POST") asked.push(String(init.body));
        return Response.json({ turns: [] });
      }),
    );
    // A result that asks for a change is a line of the Agent card.
    workspace.strategy.verdict = "out of reach";
    const first = renderWorkspace(workspace);
    expect(await screen.findByTestId("seo-agent-strategy")).toHaveTextContent(
      "Keyword strategy: Most searches of these keywords are out of reach for the site",
    );
    first.unmount();
    // "Keep these keywords" asks for nothing: the card does not say it.
    workspace.strategy.verdict = "keep";
    renderWorkspace(workspace);
    // The step is one row that leads to the list: the whole row is the button.
    const step = await screen.findByRole("button", {
      name: "3 actions from the keyword strategy",
    });
    expect(step.closest("li")).not.toBeNull();
    expect(screen.queryByTestId("seo-agent-strategy")).toBeNull();
    // The Audit has no page action; the strategy actions alone show the tab.
    expect(screen.getByRole("tab", { name: "Actions" })).toBeVisible();
    await user.click(step);
    expect(
      await screen.findByRole("heading", {
        name: "Actions from the keyword strategy",
      }),
    ).toBeVisible();
    // "No recommended actions" above these cards would say two things at once.
    expect(screen.queryByRole("heading", { name: "Actions" })).toBeNull();
    expect(screen.queryByText("No recommended actions")).toBeNull();
    // Without an Actions list the page details stand in a card of their own, a section of the tab.
    const details = screen.getByRole("heading", {
      level: 2,
      name: "Page details",
    });
    expect(details.closest("section")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const page = screen
      .getByRole("heading", { name: /Write a comparison page/ })
      .closest("article");
    if (!page) throw new Error("no page card");
    // The Agent row led here, so the first card is open: the list has a lead. Every other card is one row.
    expect(within(page).getByRole("button", { expanded: true })).toBeVisible();
    // The effort is plain text, and the title alone says the kind of action: no outlined label on a row.
    expect(within(page).getByText("Effort: High")).not.toHaveAttribute(
      "data-slot",
      "badge",
    );
    expect(within(page).queryByText("On another site")).toBeNull();
    expect(within(page).queryByText("Limit")).toBeNull();
    // Each page of the listing action is a place of its own, with how easy it is in place of the effort.
    expect(
      screen.getByRole("heading", { name: "Where to show the product" }),
    ).toBeVisible();
    // The task and the site lead; the page title stays under them: a list's title reads as another product.
    const card = screen
      .getByRole("heading", {
        name: /^Ask lists\.example to list the product/,
      })
      .closest("article");
    if (!card) throw new Error("no card");
    expect(within(card).getByText("Best battery apps")).toBeVisible();
    expect(within(card).getByText("Hard")).toBeVisible();
    // A closed card is one row: its body and its button are not on the page.
    expect(
      within(card).queryByRole("button", { name: "Draft a plan" }),
    ).toBeNull();
    await user.click(within(card).getByRole("button", { expanded: false }));
    expect(within(card).getByText("The page's author decides.")).toBeVisible();
    expect(
      within(card).getByText("Ask on the product's merits only."),
    ).toBeVisible();
    const list = within(card).getByRole("link", { name: "Best battery apps" });
    expect(list).toHaveAttribute("href", "https://lists.example/best");
    expect(list.closest("li")).toHaveTextContent(
      "List of products · Does not name the product",
    );
    // The reason about all the lists stays off the row of one list.
    expect(
      within(card).queryByText("2 lists of products are in the top 10."),
    ).toBeNull();
    // A type and a state without a label add no note.
    const other = screen
      .getByRole("heading", { name: /^Ask other\.example to list the product/ })
      .closest("article");
    if (!other) throw new Error("no other card");
    await user.click(within(other).getByRole("button", { expanded: false }));
    expect(
      within(other)
        .getByRole("link", { name: "https://other.example/page" })
        .closest("li"),
    ).not.toHaveTextContent("·");
    // Both buttons have one name; each card's title tells them apart.
    expect(
      within(page).getByRole("button", { name: "Draft a plan" }),
    ).toHaveAccessibleDescription(
      "Write a comparison page for “battery app alternative”",
    );
    // An action without a limit and without places asks for neither.
    await user.click(
      within(page).getByRole("button", { name: "Draft a plan" }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Write a comparison page for “battery app alternative””. Draft a plan with the steps in order.",
    );
    await user.keyboard("{Escape}");
    await user.click(
      within(card).getByRole("button", { name: "Draft a plan" }),
    );
    // The limit goes with the question: the agent may not have this action in its evidence. The question names the
    // one place of the row. The chat field keeps the question that was not sent, and the new one follows it.
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Write a comparison page for “battery app alternative””. Draft a plan with the steps in order.\n\nThe site audit recommends: “Ask to be added to these lists of products”. Draft a plan with the steps in order. Keep to this limit: Ask on the product's merits only. The place: https://lists.example/best",
    );
    expect(asked).toEqual([]);
  });

  it("names the fixes on the Actions tab, with or without the strategy actions", async () => {
    const workspace = seoTestWorkspace();
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
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
    workspace.observations = [seoTestObservation(workspace)];
    const first = renderWorkspace(workspace, "?tab=actions");
    const tab = screen.getByRole("tabpanel", { name: "Actions" });
    const details = within(tab)
      .getByText("Check details", { selector: "summary" })
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toContainElement(
      within(tab).getByTestId("seo-summary-tiles"),
    );
    const row = within(tab).getByRole("button", { name: "Fix the page title" });
    expect(row.compareDocumentPosition(details!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(row).not.toHaveTextContent("A descriptive search result");
    // Alone on the tab, the fixes keep their title and its line: the export menu stands beside them.
    expect(
      await screen.findByRole("button", { name: /^Fix the page title/ }),
    ).toBeVisible();
    expect(
      screen
        .getByRole("heading", { name: "Recommended actions" })
        .closest(".sr-only"),
    ).toBeNull();

    // The export menu stands on the title line, inside the header of the section.
    expect(
      screen
        .getByRole("button", { name: "Export: Actions" })
        .closest("section")
        ?.querySelector("h2")?.parentElement,
    ).toContainElement(screen.getByRole("button", { name: "Export: Actions" }));
    first.unmount();
    const strategy = seoTestStrategy();
    strategy.actions = Array.from({ length: 5 }, (_, index) => ({
      ...strategy.actions[1],
      title: `Strategy action ${index + 1}`,
    }));
    workspace.strategy = strategy;
    const second = renderWorkspace(workspace, "?tab=actions");
    expect(
      (
        await screen.findByRole("heading", { name: "Recommended actions" })
      ).closest(".sr-only"),
    ).toBeNull();
    expect(
      screen.getByRole("heading", {
        name: "Actions from the keyword strategy",
      }),
    ).toBeVisible();
    // Under the fixes the strategy list starts with three rows; the button opens the rest.
    const rows = () =>
      screen
        .queryAllByText(/^Strategy action \d$/)
        .map((title) => title.textContent);
    expect(rows()).toEqual([
      "Strategy action 1",
      "Strategy action 2",
      "Strategy action 3",
    ]);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show 2 more actions" }));
    expect(rows()).toHaveLength(5);
    second.unmount();
    // The Agent row names the count of the strategy actions: it lands on their group, with every row in view.
    // With a finished check the Agent tab shows its steps.
    workspace.observations = [seoTestObservation(workspace)];
    workspace.competitors = [
      {
        id: "saved-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: 12,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    const third = renderWorkspace(workspace, "?tab=agent");
    await userEvent.setup().click(
      await screen.findByRole("button", {
        name: "5 actions from the keyword strategy",
      }),
    );
    const group = await screen.findByRole("heading", {
      name: "Actions from the keyword strategy",
    });
    await waitFor(() => expect(rows()).toHaveLength(5));
    await waitFor(() => expect(group.closest("[role='group']")).toHaveFocus());
    // Five equal rows have no lead: the first action is open on this landing, the others are closed.
    const head = (title: string) => screen.getByText(title).closest("button");
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "true");
    expect(head("Strategy action 2")).toHaveAttribute("aria-expanded", "false");
    // The landing is for one press: opened by its tab again, the group starts with three rows.
    await userEvent.setup().click(screen.getByRole("tab", { name: "Agent" }));
    await userEvent.setup().click(screen.getByRole("tab", { name: "Actions" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "false");
    // The list of sites in the results has the same way to the group.
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Rankings" }));
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Competitors" }));
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Next step: 5 actions from the keyword strategy",
      }),
    );
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(head("Strategy action 1")).toHaveAttribute("aria-expanded", "true");
    third.unmount();
    // Alone on the tab the list is the page: it shows every row.
    workspace.actions = [];
    renderWorkspace(workspace, "?tab=actions");
    expect(await screen.findAllByText(/^Strategy action \d$/)).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /more actions/ })).toBeNull();
  });

  it("does not repeat a type that every thread of a place shares", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const strategy = seoTestStrategy();
    const [action] = strategy.actions;
    strategy.actions = [
      {
        ...action,
        kind: "promote",
        title: "Present the product in r/macapps",
        place: {
          name: "r/macapps",
          url: "https://www.reddit.com/r/macapps/",
          form: "community",
        },
        targets: action.targets.map((target) => ({
          ...target,
          type: "forum",
        })),
      },
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    const list = await screen.findByRole("link", { name: "Best battery apps" });
    // The state still tells the threads apart. The type is the same on each line, and the place names it.
    expect(list.closest("li")).toHaveTextContent("Does not name the product");
    expect(list.closest("li")).not.toHaveTextContent("Forum");
  });

  it("shows a promotion action's place as a link and its text with a copy button; the question names the place", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const draft =
      "I make Battery Sensei.\n\nIt shows the charge of each device.";
    const strategy = seoTestStrategy();
    strategy.actions = [
      {
        // The targets stay: for a promotion action they are the threads that show the place.
        ...strategy.actions[0],
        kind: "promote",
        title: "Answer in r/macapps",
        place: {
          name: "r/macapps",
          url: "https://www.reddit.com/r/macapps/",
          form: "community",
        },
        draft,
      },
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(url.endsWith("/chat") ? { turns: [] } : workspace),
      ),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    expect(
      await screen.findByRole("link", { name: "r/macapps" }),
    ).toHaveAttribute("href", "https://www.reddit.com/r/macapps/");
    // The name does not say which site the link opens, so the site shows beside it.
    expect(screen.getByText("Community · reddit.com")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Best battery apps" }),
    ).toBeVisible();
    // The line breaks are part of the post.
    const text = screen.getByTestId("seo-strategy-draft");
    expect(text.textContent).toBe(draft);
    expect(text).toHaveClass("whitespace-pre-wrap");
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy text" }));
    expect(write).toHaveBeenCalledWith(draft);
    await user.click(screen.getByRole("button", { name: "Draft a plan" }));
    expect(
      within(await screen.findByRole("dialog")).getByLabelText("Your question"),
    ).toHaveValue(
      "The site audit recommends: “Answer in r/macapps”. Draft a plan with the steps in order. Keep to this limit: Ask on the product's merits only. The place: https://www.reddit.com/r/macapps/",
    );
  });

  it("shows the notes on promotion places on the Actions tab, also when the audit has no action", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    const strategy = seoTestStrategy();
    strategy.actions = [];
    strategy.placesNotes = [
      "the place_fit agent gave no answer for r/macapps, so it shows without a ready text",
      "forums.macrumors.com is in 3 of 5 SERP reads, but its terms ban promotion (its terms page), so it is no place",
    ];
    workspace.strategy = strategy;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.click(await screen.findByRole("tab", { name: "Actions" }));
    const section = await screen.findByTestId("seo-strategy-place-notes");
    expect(
      within(section)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(strategy.placesNotes);
    expect(
      screen.getByRole("heading", { name: "Promotion places" }),
    ).toBeVisible();
  });

  it("keeps the Actions tab without actions: the health of the site stands on it", async () => {
    const workspace = seoTestWorkspace();
    workspace.actions = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(await screen.findByRole("tab", { name: "Agent" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Rankings" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Actions" })).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Health" })).toBeNull();
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
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: null,
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
      observedAt: null,
      observationId: null,
    });
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
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
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=rankings");
    expect(await screen.findByText("Stablecoins")).toBeVisible();
    // Paid columns can never fill, and no Analytics data exists.
    expect(screen.queryByText(/Search volume/)).toBeNull();
    expect(screen.queryByText(/Track one to see/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Traffic" })).toBeNull();
    // A competitor without numbers says why, instead of a bare URL.
    await userEvent.click(screen.getByRole("button", { name: "Competitors" }));
    expect(
      screen.getByText(
        "Rank and backlink numbers need paid search data, which is off in this workspace.",
      ),
    ).toBeVisible();
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
            : url.includes("/api/seo/connections/")
              ? { status: "not_connected", source: "none" }
              : workspace,
        ),
      ),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(userEvent);
    // No account yet: each source asks for its account. The property fields follow the approval.
    const dialog = await screen.findByRole("dialog", {
      name: "Google connections",
    });
    for (const name of ["Connect Search Console", "Connect Google Analytics"])
      expect(await within(dialog).findByRole("button", { name })).toBeVisible();
    expect(within(dialog).queryAllByTestId(/^seo-statistics-reads-/)).toEqual(
      [],
    );
    expect(
      within(dialog).queryByRole("button", { name: "Sync statistics" }),
    ).toBeNull();
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
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    expect(
      await screen.findByText("Only you can read this chat"),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Your question" }),
    ).toHaveAccessibleDescription(
      "This conversation and your connected statistics are visible only to you.",
    );
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
    const view = renderWorkspace(workspace, "?tab=rankings");
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
      const view = renderWorkspace(workspace, "?tab=rankings");
      await user.click(
        screen.getByRole("button", { name: "Ask the SEO agent" }),
      );
      await screen.findByText("Owner private history reply");
      await user.type(
        screen.getByLabelText("Your question"),
        "Pending question",
      );
      await user.click(screen.getByRole("button", { name: "Send question" }));
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
    renderWorkspace(workspace, `?pageId=${workspace.pages[0].id}&tab=rankings`);
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(question).toHaveValue(""));
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
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
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
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
    renderWorkspace(workspace, "?tab=rankings");
    await user.click(screen.getByRole("button", { name: "Ask the SEO agent" }));
    const question = screen.getByLabelText("Your question");
    await user.type(question, "What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await screen.findAllByRole("alert");
    expect(question).toHaveValue("What should I fix first?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].idempotencyKey).not.toBe(requests[0].idempotencyKey);
  });

  it("keeps the run in the secondary look and the draft button tinted, with its reasons in its details", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: {
        target: "title",
        before: null,
        after: "<title>Battery Sensei</title>",
      },
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    });
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      volume: null,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: "mobile",
      checkedResults: 20,
      observedAt,
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    } as const;
    workspace.keywords.push(
      {
        ...read,
        id: "found",
        keyword: "battery app",
        position: 4,
        positionStatus: "ranked",
      },
      {
        ...read,
        id: "missing",
        keyword: "charge timer",
        position: null,
        positionStatus: "not_in_range",
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // The lead step opens its action; the Task is drafted in the dialog, next to its reasons.
    const openAction = await screen.findByRole("button", {
      name: "Open action",
    });
    expect(openAction).toHaveClass("bg-quinary");
    expect(
      screen.queryByRole("button", { name: "Create draft task" }),
    ).toBeNull();
    const run = screen.getByRole("button", { name: "Run full audit" });
    expect(run).toHaveClass("bg-quaternary");
    expect(run).not.toHaveClass("bg-primary");
    expect(run).not.toHaveAttribute("aria-disabled");
    // The position result leads the Agent tab, as a figure under the verdict.
    expect(
      screen.getByRole("button", {
        name: "1 of 2 keywords found · 20 results read per keyword",
      }),
    ).toBeVisible();
    // The lead row is short: its reasons are in the dialog it opens.
    expect(screen.queryByText("The title is missing")).toBeNull();
    // The button leads to the Actions tab, where the action opens among the others.
    await user.click(openAction);
    const dialog = await screen.findByRole("dialog", {
      name: "Fix the page title",
    });
    expect(
      within(dialog).getByRole("button", { name: "Create draft task" }),
    ).toHaveClass("bg-quinary");
    // The dialog shows the reasons at once, and the fix and the whole action can be copied.
    expect(within(dialog).getByText("The title is missing")).toBeVisible();
    expect(
      within(dialog).getByText("A descriptive search result"),
    ).toBeVisible();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(
      within(dialog).getByRole("button", { name: "Copy change" }),
    );
    expect(write).toHaveBeenLastCalledWith("<title>Battery Sensei</title>");
    await user.click(
      within(dialog).getByRole("button", { name: "Copy agent instructions" }),
    );
    expect(write).toHaveBeenLastCalledWith(
      [
        "Make this SEO change on the website. Change only what it names, then check the page again.",
        "Fix the page title",
        "Page: https://example.com/",
        "A descriptive search result",
        "The title is missing",
        "Suggested change:\n<title>Battery Sensei</title>",
      ].join("\n\n"),
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Focus goes to the action's row in the list of the Actions tab, not to the page.
    const listed = within(
      screen.getByRole("list", { name: "Actions" }),
    ).getByRole("button", { name: /^Fix the page title/ });
    await waitFor(() => expect(listed).toHaveFocus());
    expect(screen.queryByText("The title is missing")).toBeNull();
    // The dialog does not open again by itself: the Agent tab and back open the list alone.
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(
      within(screen.getByRole("list", { name: "Actions" })).getByRole(
        "button",
        { name: /^Fix the page title/ },
      ),
    );
    expect(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Create draft task",
      }),
    ).toHaveClass("bg-quinary");
  });

  it("keeps the lead fix tinted, also while no check can start", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    workspace.availableActions = {
      ...workspace.availableActions,
      canRequestAnalysis: false,
    };
    workspace.observations.push({
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    workspace.actions.push({
      id: "action-row",
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
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
    renderWorkspace(workspace);
    // The run cannot start: the lead button stays tinted, with no brand fill on the tab (owner, 2026-11-13).
    expect(
      await screen.findByRole("button", { name: "Open action" }),
    ).toHaveClass("bg-quinary");
    expect(screen.queryByRole("button", { name: "Run full audit" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await user.click(
      await screen.findByRole("button", { name: /^Fix the page title/ }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Create draft task",
      }),
    ).toHaveClass("bg-quinary");
  });

  it("leads from a position check that found no page to the fixes, and only then", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const [check] = workspace.observations;
    workspace.actions.push({
      id: "fix-title",
      observationId: check.id,
      pageUrl: "https://example.com/",
      findingIds: [],
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
    // An idea for a new page is no fix: the row does not count it.
    workspace.actions.push({
      ...workspace.actions[0],
      id: "idea",
      title: "Write a guide",
      kind: "opportunity",
    });
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      volume: null,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
      device: "mobile",
      checkedResults: 20,
      observedAt: check.observedAt,
      observationId: check.id,
      position: null,
      positionStatus: "not_in_range",
    } as const;
    workspace.keywords.push(
      { ...read, id: "first", keyword: "battery app" },
      { ...read, id: "second", keyword: "charge timer" },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=rankings");
    // "0 of 2" alone is a dead end: "Track" on a row does not answer it. The fixes are the next step.
    await user.click(
      await screen.findByRole("button", {
        name: "Next step: 1 fix",
      }),
    );
    expect(screen.getByRole("tab", { name: "Actions" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    cleanup();
    // One keyword in the results: the card has a result to show, and the row would be a second call to act.
    workspace.keywords[0] = {
      ...workspace.keywords[0],
      position: 4,
      positionStatus: "ranked",
    };
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      await screen.findByRole("tab", { name: "Rankings" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("charge timer").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /^Next step: \d+ fix/ }),
    ).toBeNull();
    cleanup();
    // No keyword in the results and no fix to offer: a row to an empty list would be the dead end again.
    workspace.keywords[0] = {
      ...workspace.keywords[0],
      position: null,
      positionStatus: "not_in_range",
    };
    workspace.actions = workspace.actions.filter(
      (action) => action.kind !== "fix",
    );
    renderWorkspace(workspace, "?tab=rankings");
    expect(
      await screen.findByRole("tab", { name: "Rankings" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("charge timer").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /^Next step: \d+ fix/ }),
    ).toBeNull();
  });

  it("shows one fix as a card on the Agent tab and each later fix as a row that opens it in a dialog", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    });
    const fix: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId,
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...fix, id: "title", title: "Fix the page title" },
      { ...fix, id: "description", title: "Write a description" },
      { ...fix, id: "heading", title: "Add a main heading" },
      { ...fix, id: "alt", title: "Describe the images" },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // Only the top fix has its own button, which opens it; its reasons and its Task button wait in the dialog.
    expect(
      await screen.findAllByRole("button", { name: "Open action" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Create draft task" }),
    ).toBeNull();
    const leadList = screen.getByRole("list", { name: "The agent proposes" });
    const leadRow = within(leadList).getByRole("button", {
      name: /^Fix the page title/,
    });
    expect(leadRow).toBeVisible();
    // The finding describes the row; the name stays short.
    expect(leadRow).toHaveAccessibleDescription(fix.expectedEffect);
    expect(leadRow.textContent).toContain(fix.expectedEffect);
    expect(leadRow).not.toHaveAccessibleName(
      expect.stringContaining(fix.expectedEffect),
    );
    expect(
      within(leadList).getByRole("button", { name: "Open action" }),
    ).toBeVisible();
    // Every fix is a row of the same list, right after the first: no press hides them.
    expect(screen.queryByRole("button", { name: /more steps?$/ })).toBeNull();
    expect(screen.getByText("Describe the images")).toBeVisible();
    const row = screen.getByText("Write a description").closest("li");
    expect(row).not.toBeNull();
    expect(leadList).toContainElement(row);
    expect(
      within(leadList)
        .getAllByRole("listitem")
        .map((item) => item.textContent?.slice(0, 18)),
    ).toEqual([
      expect.stringMatching(/^Fix the page title/),
      "Write a descriptio",
      "Add a main heading",
      "Describe the image",
      "No competitor has ",
    ]);
    // One page: the row needs no page.
    expect(within(row!).queryByRole("link")).toBeNull();
    // The whole row is the control: no second button repeats it.
    expect(within(row!).getAllByRole("button")).toHaveLength(1);
    const rowButton = within(row!).getByRole("button", {
      name: /^Write a description/,
    });
    // A press opens the fix in a dialog on the same tab, with its own button.
    await user.click(rowButton);
    const dialog = await screen.findByRole("dialog", {
      name: "Write a description",
    });
    expect(
      within(dialog).getByRole("button", { name: "Create draft task" }),
    ).toBeVisible();
    // The reasons show at once, under a heading of their own.
    expect(
      within(dialog).getByRole("heading", { name: "Why this matters" }),
    ).toBeVisible();
    expect(within(dialog).getByText(fix.why)).toBeVisible();
    // Closing it returns the focus to the row, still on the Agent tab.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(rowButton).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Agent" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // The Actions tab lists each fix as a row too, and a press opens the same dialog there.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    const list = await screen.findByRole("list", { name: "Actions" });
    expect(within(list).getAllByRole("button")).toHaveLength(4);
    // One level of impact splits nothing: no filter over the rows. Fixes with no rated issue are no suggestions.
    expect(screen.queryByRole("group", { name: "Filter actions" })).toBeNull();
    expect(screen.queryByText(/They are not errors/)).toBeNull();
    const listed = within(list).getByRole("button", {
      name: /^Write a description/,
    });
    await user.click(listed);
    expect(
      within(
        await screen.findByRole("dialog", { name: "Write a description" }),
      ).getByRole("button", { name: "Create draft task" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(listed).toHaveFocus();
    cleanup();
    // With several pages two fixes can have one title: the row names its page.
    const pricing = "https://example.com/pricing";
    const second = "a658c5bb-3084-4b26-81ee-b3208ee5ab61";
    // No name of its own: the row names the page by its path.
    workspace.pages.push({
      ...workspace.pages[0],
      id: second,
      url: pricing,
      label: "",
    });
    workspace.scope = {
      ...workspace.scope,
      pageIds: [...workspace.scope.pageIds, second],
    };
    workspace.actions[1] = { ...workspace.actions[1], pageUrl: pricing };
    workspace.actions[3] = {
      ...workspace.actions[3],
      kind: "opportunity",
      title: "Write a guide",
    };
    renderWorkspace(workspace, "?tab=agent");
    const paged = screen.getByText("Write a description").closest("li");
    expect(within(paged!).getByText("/pricing")).toBeVisible();
    // The row of a suggestion does not call it a fix.
    const suggestion = screen.getByText("Write a guide").closest("li");
    expect(within(suggestion!).getAllByRole("button")).toHaveLength(1);
    expect(
      within(suggestion!).getByRole("button", { name: /^Write a guide/ }),
    ).toBeVisible();
    cleanup();
    // Without an action the one step sits in the verdict card: no list follows the pictures.
    workspace.actions = [];
    renderWorkspace(workspace, "?tab=agent");
    const firstStep = await screen.findByRole("list", {
      name: "The agent proposes",
    });
    expect(firstStep).toBeVisible();
    expect(
      screen.getByTestId("seo-agent-verdict").parentElement,
    ).toContainElement(firstStep);
    // Inside the card the step has no frame of its own.
    expect(within(firstStep).getByRole("listitem")).not.toHaveClass("border");
    expect(
      screen.queryByRole("heading", { name: "The agent proposes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Nothing is waiting. The agent syncs Search Console when you open this audit and the data is older than a day.",
      ),
    ).toBeNull();
  });

  it("creates one draft action Task with its source references and guards repeated clicks", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const waiting = {
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
    } as const;
    workspace.actions.push(
      // An action with a Task comes first in the list; the card opens on the one that still waits.
      {
        ...waiting,
        id: "action-with-task",
        findingIds: [],
        evidence: [],
        title: "Add a meta description",
        taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
        status: "task_created",
      },
      { ...waiting, findingIds: ["finding"], evidence: [] },
    );
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
    await user.click(
      screen.getByRole("button", { name: /^Fix the page title/ }),
    );
    const create = within(await screen.findByRole("dialog")).getByRole(
      "button",
      { name: "Create draft task" },
    );
    expect(create).toHaveClass("bg-quinary");
    await user.dblClick(create);
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

  it("keeps the dialog on its action once a Task exists for it, and marks its row", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const waiting: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...waiting, id: "title", title: "Fix the page title" },
      { ...waiting, id: "description", title: "Write a description" },
    );
    let served = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(served)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace, "?tab=actions");
    const row = screen.getByRole("button", { name: /^Fix the page title/ });
    expect(row).toHaveTextContent("Effort: Low");
    await user.click(row);
    const dialog = await screen.findByRole("dialog", {
      name: "Fix the page title",
    });
    served = {
      ...workspace,
      actions: [
        {
          ...workspace.actions[0],
          taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
          status: "task_created",
        },
        workspace.actions[1],
      ],
    };
    await user.click(
      within(dialog).getByRole("button", { name: "Create draft task" }),
    );
    // The dialog stays on its action and shows the Task; the row says a Task exists in the place of the effort.
    expect(
      await within(dialog).findByRole("link", { name: "Open task" }),
    ).toHaveAttribute("href", "/tasks/3c34c8d3-5c56-47ef-8ddc-a17898de494e");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: /^Fix the page title/ }),
    ).toHaveTextContent("Draft task created");
  });

  it("puts the next waiting action in the verdict card once a Task exists for the first", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const [check] = workspace.observations;
    const waiting: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId: check.id,
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...waiting, id: "title", title: "Fix the page title" },
      { ...waiting, id: "description", title: "Write a description" },
      { ...waiting, id: "alt", title: "Describe the images" },
    );
    let served = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(served)),
    );
    renderWorkspace(workspace, "?tab=agent");
    const first = await screen.findByRole("list", {
      name: "The agent proposes",
    });
    expect(within(first).getByText(/^Fix the page title/)).toBeVisible();
    served = {
      ...workspace,
      actions: [
        {
          ...workspace.actions[0],
          taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
          status: "task_created",
        },
        workspace.actions[1],
        workspace.actions[2],
      ],
    };
    // A Task made elsewhere reaches the tab on its next load, while the focus is on the lead's button.
    act(() =>
      within(first).getByRole("button", { name: "Open action" }).focus(),
    );
    await act(() => clients.at(-1)!.invalidateQueries());
    // The next action leads in the card. Focus left with the button, so it goes to the verdict.
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "The agent proposes" }),
        ).getByText(/^Write a description/),
      ).toBeVisible(),
    );
    const verdict = screen.getByTestId("seo-agent-verdict");
    expect(verdict).toHaveFocus();
    // Focus that left the list by a click on the page moves no focus when the lead changes.
    act(() =>
      within(screen.getByRole("list", { name: "The agent proposes" }))
        .getByRole("button", { name: "Open action" })
        .focus(),
    );
    expect(
      screen.getByRole("list", { name: "The agent proposes" }),
    ).toContainElement(document.activeElement as HTMLElement);
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);
    served = {
      ...served,
      actions: served.actions.map((action) =>
        action.id === "description"
          ? {
              ...action,
              taskId: "9f0c2d6e-1a4b-4c3d-8e5f-6a7b8c9d0e1f",
              status: "task_created",
            }
          : action,
      ),
    };
    await act(() => clients.at(-1)!.invalidateQueries());
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("list", { name: "The agent proposes" }),
        ).getByText(/^Describe the images/),
      ).toBeVisible(),
    );
    expect(verdict).not.toHaveFocus();
  });

  it("keeps an action's dialog open to show the Task its button created", async () => {
    const user = userEvent.setup();
    const workspace = seoTestCheckedAudit();
    const [check] = workspace.observations;
    const waiting: Omit<(typeof workspace.actions)[number], "id" | "title"> = {
      observationId: check.id,
      pageUrl: "https://example.com/",
      findingIds: [],
      why: "The check found it",
      effort: "low",
      expectedEffect: "A better search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    workspace.actions.push(
      { ...waiting, id: "title", title: "Fix the page title" },
      { ...waiting, id: "description", title: "Write a description" },
    );
    let served = workspace;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(served)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace, "?tab=agent");
    await user.click(
      screen.getByRole("button", { name: /^Write a description/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Write a description",
    });
    served = {
      ...workspace,
      actions: [
        workspace.actions[0],
        {
          ...workspace.actions[1],
          taskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
          status: "task_created",
        },
      ],
    };
    await user.click(
      within(dialog).getByRole("button", { name: "Create draft task" }),
    );
    // The row leaves the steps with its Task; the dialog stays and shows the Task.
    await waitFor(() =>
      expect(
        // The open dialog hides the page from roles: the query looks past that, or it is empty at once.
        screen.queryByRole("button", {
          name: /^Write a description/,
          hidden: true,
        }),
      ).toBeNull(),
    );
    expect(
      within(screen.getByRole("dialog")).getAllByText("Draft task created")[0],
    ).toBeVisible();
    // Its row is gone, so closing gives the focus to the verdict.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("seo-agent-verdict")).toHaveFocus();
  });

  it("says what a keyword result of zero means, with the depth the check read", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 201, skipped: 0, failed: 0 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 20,
      observedAt,
      observationId,
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    // A second read looked deeper; the sentence names the depth every read reached.
    workspace.keywords.push({
      ...workspace.keywords[workspace.keywords.length - 1],
      id: "missing-deep",
      keyword: "charge limit",
      checkedResults: 100,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // "0 of 2" is no "not in Google": the figure names the results the check read.
    expect(
      await screen.findByRole("button", {
        name: "0 of 2 keywords found · 20 to 100 results read per keyword",
      }),
    ).toBeVisible();
    // The line that dates the check shows the day: two reads of one check differ by minutes.
    expect(screen.getAllByText("Jan 3, 2026").length).toBeGreaterThan(0);
  });

  it("names no depth where a read has none, and splits the tests without a result", async () => {
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.availableActions = {
      canEdit: false,
      canRequestAnalysis: false,
      canCreateMonitor: false,
      canUsePaidSearchData: false,
      canSyncMetrics: false,
    };
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 198, skipped: 2, failed: 1 },
    });
    workspace.keywords.push({
      id: "missing",
      keyword: "charge timer",
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      // This read has no depth, so the sentence names none.
      checkedResults: null,
      observedAt,
      observationId,
      position: null,
      positionStatus: "not_in_range",
      volume: 90,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(
      await screen.findByRole("button", {
        name: "0 of 1 keyword found",
      }),
    ).toBeVisible();
    // The tests tile splits the tests without a result the way the Timeline row of the check does.
    await userEvent.click(screen.getByRole("tab", { name: "Actions" }));
    await userEvent.click(
      screen.getByText("Check details", { selector: "summary" }),
    );
    const tests = screen.getByTestId("seo-summary-tests");
    expect(within(tests).getByText("2 tests gave no result")).toBeVisible();
    expect(within(tests).getByText("1 unavailable")).toBeVisible();
  });

  it("shows the keyword numbers on the Agent tab and the page-check numbers on Actions, and one Rankings list at a time", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observationId = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
    workspace.observations.push({
      id: observationId,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: workspace.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 1,
      coverage: { checked: 201, skipped: 30, failed: 0 },
    });
    const older = {
      ...workspace.observations[0],
      id: "51fd7134-4a26-42a8-b8d3-631684028a27",
      observedAt: new Date("2026-01-01T12:00:00Z"),
    };
    workspace.observations.push(older);
    const failed = {
      observationId,
      pageUrl: workspace.pages[0].url,
      evidence: [],
      sourceRef: "html:head",
      observedAt,
    };
    workspace.findings.push(
      // One rule on both devices is one major issue.
      {
        ...failed,
        id: "markup-mobile",
        device: "mobile",
        rowId: "SD-06",
        title: "Markup matches the visible page",
        severity: "major",
      },
      {
        ...failed,
        id: "markup-desktop",
        device: "desktop",
        rowId: "SD-06",
        title: "Markup matches the visible page",
        severity: "major",
      },
      {
        ...failed,
        id: "alt",
        observationId: older.id,
        observedAt: older.observedAt,
        device: "desktop",
        rowId: "P-06",
        title: "Images have alt text",
        severity: "minor",
      },
    );
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 20,
      observedAt,
      observationId,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    workspace.keywords.push(
      {
        ...read,
        id: "found",
        keyword: "battery app",
        position: 4,
        positionStatus: "ranked",
        volume: 720,
        intent: "commercial",
      },
      {
        ...read,
        id: "missing",
        keyword: "charge timer",
        position: null,
        positionStatus: "not_in_range",
        volume: 90,
        intent: null,
      },
      {
        ...read,
        id: "idea",
        keyword: "battery widget",
        source: "gap",
        position: null,
        positionStatus: "unavailable",
        checkedResults: null,
        volume: 50,
        intent: null,
      },
    );
    workspace.competitors.push({
      id: "rival",
      url: "https://rival.example/",
      role: "competitor",
      confirmed: false,
      source: "search",
      rank: 1,
      backlinks: null,
      referringDomains: 10,
      observedAt,
      observationId,
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // The Agent tab says the issue count once, in its headline, and shows the keyword numbers.
    expect(
      await screen.findByRole("heading", {
        name: "1 issue to fix: 1 high impact",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("1 issue to fix: 1 high impact")).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole("heading", { name: "The agent proposes" }),
    ).toBeNull();
    expect(screen.queryByTestId("seo-summary-issues")).toBeNull();
    expect(screen.queryByTestId("seo-summary-tests")).toBeNull();
    const figures = screen.getByTestId("seo-agent-figures");
    expect(
      within(figures).getByRole("button", { name: /^1 of 2 keywords found/ }),
    ).toBeVisible();
    // Every checked keyword has a number: the figure names no share of them.
    expect(
      within(figures).getByRole("button", { name: "810 searches a month" }),
    ).toBeVisible();
    // The Actions tab leads with the numbers of the page check, and not with the keyword numbers.
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    await userEvent.click(
      screen.getByText("Check details", { selector: "summary" }),
    );
    const issues = screen.getByTestId("seo-summary-issues");
    expect(issues).toHaveTextContent(/^1/);
    expect(within(issues).getByText("1 high impact")).toBeVisible();
    expect(within(issues).queryByText("1 low impact")).toBeNull();
    const earlierHeading = screen.getByRole("heading", {
      name: "Still open from earlier checks (1)",
    });
    expect(earlierHeading).toBeVisible();
    expect(earlierHeading.closest("section")).toHaveTextContent(
      "Images have alt text",
    );
    // Tests without a result are part of the total, not hidden. With one kind of them the total says it:
    // a line "30 tests gave no result" would say 231 minus 201 a second time.
    const tests = screen.getByTestId("seo-summary-tests");
    expect(tests).toHaveTextContent("201 of 231");
    expect(within(tests).queryByText(/gave no result/)).toBeNull();
    // The count behind "of 231" is the hint of those words.
    expect(within(tests).getByText("of 231")).toHaveAttribute(
      "title",
      "30 tests gave no result",
    );
    // The issues can come from older checks: the tile dates its check.
    expect(tests).toHaveTextContent("Last check Jan 3, 2026");
    expect(
      screen.queryByRole("button", { name: /keywords? found/ }),
    ).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Agent" }));
    // The keyword figure is the way to the Rankings tab.
    await user.click(
      screen.getByRole("button", { name: /^1 of 2 keywords found/ }),
    );
    expect(screen.getByRole("tab", { name: "Rankings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // One keyword is found, so the Position column shows.
    expect(screen.getByText("Not found")).toBeVisible();
    // The lists have no Intent column: the word drives no action here.
    expect(screen.queryByText("Not available")).toBeNull();
    expect(screen.queryByText(/intent/i)).toBeNull();
    // One list shows at a time.
    const part = (name: string | RegExp) =>
      screen.getByRole("heading", { name }).closest("section")?.parentElement;
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    expect(part(/^Sites in Google's results/)).toHaveClass("hidden");
    const competitors = screen.getByRole("button", { name: "Competitors" });
    expect(competitors).toHaveAttribute("aria-pressed", "false");
    await user.click(competitors);
    expect(competitors).toHaveAttribute("aria-pressed", "true");
    expect(part(/^Sites in Google's results/)).not.toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Ideas" }));
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
    expect(part(/^Sites in Google's results/)).toHaveClass("hidden");
    // The last idea leaves the list (the reader tracked it): the keywords show, not an empty tab.
    const client = clients.at(-1);
    const queries =
      client
        ?.getQueryCache()
        .getAll()
        .filter(({ queryKey }) => queryKey[0] === "seo-workspace") ?? [];
    if (!client || !queries.length) throw new Error("Workspace query missing");
    await act(async () => {
      for (const { queryKey } of queries)
        client.setQueryData(queryKey, {
          ...workspace,
          keywords: workspace.keywords.filter((row) => row.id !== "idea"),
        });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ideas" })).toBeNull(),
    );
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
    expect(screen.getByRole("button", { name: "Keywords" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers a saved page selection from three pages on", () => {
    const workspace = seoTestWorkspace();
    workspace.scopes = [];
    workspace.pages.push({
      ...workspace.pages[0],
      id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
      url: "https://example.com/pricing",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace, "?tab=health");
    // With two pages a selection is one page or both, and the page picker offers each.
    const pages = screen
      .getByRole("heading", { name: "Pages" })
      .closest("section");
    if (!pages) throw new Error("Pages card missing");
    expect(
      within(pages).queryByRole("button", { name: "Save page selection" }),
    ).toBeNull();
    expect(
      within(pages).getByRole("button", { name: "Add a page" }),
    ).toBeVisible();
  });

  it("shows keywords and ideas together while a search holds text, and opens on the ideas without a checked keyword", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const read = {
      countryCode: "US",
      languageCode: "en",
      pageUrl: workspace.pages[0].url,
      targetPageId: null,
      saved: false,
      priority: "medium",
      version: 0,
      source: "focus",
      device: "mobile",
      checkedResults: 20,
      observedAt: new Date("2026-11-11T00:26:00Z"),
      observationId: "observation",
      volume: 50,
      intent: null,
      difficulty: null,
      clicks: null,
      conversion: null,
      feature: null,
    } as const;
    const idea = {
      ...read,
      id: "idea",
      keyword: "battery widget",
      source: "gap",
      position: null,
      positionStatus: "unavailable",
      checkedResults: null,
    } as const;
    // Twenty keywords: enough for the search box.
    workspace.keywords = [
      ...Array.from({ length: 20 }, (_, index) => ({
        ...read,
        id: `read-${index}`,
        keyword: `read ${index}`,
        position: index + 1,
        positionStatus: "ranked" as const,
      })),
      idea,
    ];
    // The workspace reads the Audit on mount; never let it reach a real server.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    const part = (name: string | RegExp) =>
      screen.getByRole("heading", { name }).closest("section")?.parentElement;
    renderWorkspace(workspace, "tab=rankings");
    expect(screen.getByRole("button", { name: "Keywords" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    // One box searches both lists: a match in the ideas does not hide behind the switch.
    const search = screen.getByPlaceholderText("Filter keywords");
    await user.type(search, "widget");
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).not.toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Competitors" }));
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    expect(part(/^In Google's top results for/)).toHaveClass("hidden");
    await user.click(screen.getByRole("button", { name: "Keywords" }));
    await user.clear(search);
    expect(part(/^\d+ keyword ideas?$/)).toHaveClass("hidden");
    cleanup();
    // Ideas and no tracked or checked keyword: the Keywords list is empty, so the tab opens on the ideas.
    workspace.keywords = [idea];
    renderWorkspace(workspace, "tab=rankings");
    expect(screen.getByRole("button", { name: "Ideas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(part(/^\d+ keyword ideas?$/)).not.toHaveClass("hidden");
  });

  it("re-reads the workspace after a save once a late viewer session arrives", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    let workspaceReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (!url.startsWith("/api/seo/connections/")) {
          workspaceReads += 1;
        }
        return connectedSeoResponse(workspace, url);
      }),
    );
    mutate.mockResolvedValueOnce({ ok: true, value: workspace });

    function SaveProbe() {
      const model = useSeoWorkspace(workspace);
      return (
        <button
          type="button"
          onClick={() =>
            void model.execute({
              kind: "save_competitor",
              body: { url: "https://rival.example", confirmed: true },
            })
          }
        >
          Save probe
        </button>
      );
    }

    viewer.userId = null;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const wrap = () => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          formats={createFormats()}
          messages={messages}
        >
          <NuqsTestingAdapter hasMemory>
            <SaveProbe />
          </NuqsTestingAdapter>
        </NextIntlClientProvider>
      </QueryClientProvider>
    );

    const view = render(wrap());
    expect(workspaceReads).toBe(0);

    viewer.userId = "owner";
    view.rerender(wrap());
    await waitFor(() => expect(workspaceReads).toBeGreaterThan(0));
    const readsBeforeSave = workspaceReads;

    await user.click(screen.getByRole("button", { name: "Save probe" }));
    await waitFor(() =>
      expect(workspaceReads).toBeGreaterThan(readsBeforeSave),
    );
  });

  it("refetches with the latest committed viewer after a 409 conflict on edit", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const readViewerHeaders: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("/api/seo/connections/")) {
          const headers = new Headers(init?.headers);
          readViewerHeaders.push(headers.get("x-seo-viewer"));
        }
        return connectedSeoResponse(workspace, url);
      }),
    );
    mutate.mockResolvedValueOnce({
      ok: false,
      error: { status: 409, code: "CONFLICT", message: "Conflict" },
    });

    function EditProbe() {
      const model = useSeoWorkspace(workspace);
      return (
        <button
          type="button"
          onClick={() =>
            void model.execute({
              kind: "save_competitor",
              body: { url: "https://rival.example", confirmed: true },
            })
          }
        >
          Edit probe
        </button>
      );
    }

    viewer.userId = null;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const wrap = () => (
      <QueryClientProvider client={client}>
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          formats={createFormats()}
          messages={messages}
        >
          <NuqsTestingAdapter hasMemory>
            <EditProbe />
          </NuqsTestingAdapter>
        </NextIntlClientProvider>
      </QueryClientProvider>
    );

    const view = render(wrap());
    expect(readViewerHeaders).toEqual([]);

    viewer.userId = "owner";
    view.rerender(wrap());
    await waitFor(() => expect(readViewerHeaders.length).toBeGreaterThan(0));
    const readsBeforeConflict = readViewerHeaders.length;

    await user.click(screen.getByRole("button", { name: "Edit probe" }));
    await waitFor(() =>
      expect(readViewerHeaders.length).toBeGreaterThan(readsBeforeConflict),
    );
    expect(readViewerHeaders.at(-1)).toBe("owner");
  });

  it("does not reopen an action dialog when the last action leaves and later returns", async () => {
    const user = userEvent.setup();
    const base = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    const observation: ProjectSeoWorkspace["observations"][number] = {
      id: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
      kind: "audit_full",
      source: "seo_coworker",
      observedAt: new Date("2026-01-03T12:00:00Z"),
      pageIds: base.scope.pageIds,
      scopeVersion: 2,
      sourceTaskId: "3c34c8d3-5c56-47ef-8ddc-a17898de494e",
      countryCode: "US",
      languageCode: "en",
      devices: ["mobile", "desktop"],
      rulebookVersion: "html-v1",
      artifactHash: "checked-html",
      issues: 0,
      coverage: { checked: 12, skipped: 0, failed: 0 },
    };
    const onlyAction: ProjectSeoWorkspace["actions"][number] = {
      id: "only-action",
      observationId: observation.id,
      pageUrl: "https://example.com/",
      findingIds: [],
      title: "Fix the page title",
      why: "The title is missing",
      effort: "low",
      expectedEffect: "A descriptive search result",
      edit: null,
      taskId: null,
      status: "recommended",
      kind: "fix",
      evidence: [],
    };
    const withAction = {
      ...base,
      observations: [observation],
      actions: [onlyAction],
    };
    const withoutAction = {
      ...base,
      observations: [observation],
      actions: [],
    };
    let currentData = withAction;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(currentData)),
    );

    renderWorkspace(withAction);
    const client = clients.at(-1)!;
    const openAction = await screen.findByRole("button", {
      name: "Open action",
    });
    await user.click(openAction);
    expect(
      await screen.findByRole("dialog", { name: "Fix the page title" }),
    ).toBeVisible();

    // Removing the last action unmounts SeoActionWorklist (SeoEmpty renders).
    currentData = withoutAction;
    await client.invalidateQueries();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("list", { name: "Actions" })).toBeNull();

    // Restoring the action remounts SeoActionWorklist; the old dialog must stay closed.
    currentData = withAction;
    await client.invalidateQueries();
    expect(await screen.findByRole("list", { name: "Actions" })).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
