import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoSetupCard } from "./seo-setup";
import { seoSetup } from "./seo-setup-model";
import {
  openStatisticsSetup,
  SEO_TEST_AUDIT,
  seoTestCheckedAudit,
  seoTestMetric,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: vi.fn() }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: { activeOrganizationId: "org" },
      user: { id: "owner" },
    },
  }),
}));

const copy = messages.App.Seo;
const clients: QueryClient[] = [];

function page(content: React.ReactNode, searchParams = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          {content}
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderWorkspace(workspace: ProjectSeoWorkspace, searchParams = "") {
  render(page(<SeoWorkspace workspace={workspace} />, searchParams));
}

/** The setup card alone, for a state change the page gets from a new read. */
function setupCard(workspace: ProjectSeoWorkspace) {
  const setup = seoSetup(workspace);
  if (!setup) throw new Error("This workspace has no setup");
  const model = { data: workspace, setDialog: vi.fn() };
  return (
    <SeoSetupCard model={model as unknown as SeoWorkspaceModel} setup={setup} />
  );
}

type Reply = Response | Promise<Response>;
/** Workspace reads answer with the workspace; the other routes answer as given. */
function network(
  workspace: ProjectSeoWorkspace,
  routes: {
    connection?: (provider: string) => object;
    chat?: (init?: RequestInit) => Reply;
  } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const { pathname } = new URL(input, "https://web.test");
      const connection = pathname.match(/\/api\/seo\/connections\/(\w+)$/);
      if (connection)
        return Response.json(
          routes.connection?.(connection[1]) ?? {
            provider: connection[1],
            name: connection[1],
            status: "not_connected",
            source: "none",
          },
        );
      if (pathname.endsWith("statistics/properties"))
        return Response.json({
          provider: "search_console",
          status: "available",
          reason: null,
          properties: [],
        });
      if (pathname.endsWith("/chat"))
        return (
          routes.chat?.(init) ??
          Response.json({ sharing: "personal", turns: [] })
        );
      return Response.json(workspace);
    }),
  );
}

/** No tab holds a thread or a question field: the floating button opens the sheet on each of them. */
async function openChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: copy.chat.title }),
  );
  return screen.findByRole("dialog", { name: copy.chat.title });
}

const primaryButtons = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole("button")
    .filter((button) => button.className.split(" ").includes("bg-primary"))
    .map((button) => button.textContent);

// The page also listens for a change of the screen width, so the stub takes listeners.
const media = (matches: boolean) =>
  ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

beforeEach(() => {
  // A pointer device: Enter sends. A touch keyboard has its own test.
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    media(query === "(hover: hover)"),
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEO audit first run", () => {
  it("has two steps, and the first audit is the one filled button", async () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    const steps = within(setup).getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    expect(
      within(steps[1]).getByRole("heading", { name: copy.setup.audit }),
    ).toBeVisible();
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(primaryButtons(setup)).toEqual(["Run full audit"]);
    // Google is no setup step, and nothing under the card competes with the first audit.
    expect(
      within(setup).queryByRole("button", { name: /Google|Sync/ }),
    ).toBeNull();
    expect(screen.queryByTestId("seo-statistics-banner")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: copy.agent.nextTitle }),
    ).toBeNull();
  });

  it("names the page check where the workspace has no paid search data", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canUsePaidSearchData = false;
    network(workspace);
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    expect(
      within(setup).getByRole("heading", { name: copy.setup.check }),
    ).toBeVisible();
    expect(within(setup).getByText(copy.setup.checkBody)).toBeVisible();
    expect(primaryButtons(setup)).toEqual(["Run page check"]);
  });

  it("offers the statistics under the card once the first check runs", async () => {
    const workspace = seoTestWorkspace();
    workspace.analyses = [
      {
        id: "a1",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
    ];
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: provider === "search_console" ? "connected" : "not_connected",
        source: "native",
      }),
    });
    renderWorkspace(workspace);
    // The check needs no more input, so the wait is the time for the statistics.
    const banner = await screen.findByTestId("seo-statistics-banner");
    expect(
      await within(banner).findByRole("button", { name: "Sync statistics" }),
    ).toBeVisible();
    const setup = screen.getByTestId("seo-setup");
    expect(within(setup).getByText(copy.setup.checkRunning)).toBeVisible();
    expect(primaryButtons(setup)).toEqual([]);
  });

  it("asks for the sync, not the account, on the Traffic tab once the account is connected", async () => {
    const workspace = seoTestWorkspace();
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: provider === "search_console" ? "connected" : "not_connected",
        source: "native",
      }),
    });
    renderWorkspace(workspace, "?tab=traffic");
    expect(
      await screen.findByText(copy.overview.trafficSyncBody),
    ).toBeVisible();
    expect(screen.queryByText(copy.queries.notConnected)).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.queries.connect }),
    ).toBeNull();
    // Nothing is measured yet: one card asks for the sync, and no second empty card asks again.
    expect(screen.queryByText(copy.queries.notSynced)).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Sync statistics" }),
    ).toHaveLength(1);
  });

  it("asks for the sync in the agent's next step once the account is connected", async () => {
    const workspace = seoTestWorkspace();
    // A finished check: the setup card is gone and the agent lists its next steps.
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
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: provider === "search_console" ? "connected" : "not_connected",
        source: "native",
      }),
    });
    renderWorkspace(workspace);
    const text = await screen.findByText(copy.agent.steps.sync.search_console);
    expect(
      screen.queryByText(copy.agent.steps.connect.search_console),
    ).toBeNull();
    // One action: the account's menu is in the sync dialog. The step is the banner, not a row of the list.
    const row = text.closest<HTMLElement>(
      '[data-testid="seo-statistics-banner"]',
    );
    if (!row) throw new Error("no statistics banner");
    expect(
      within(row).getByRole("heading", { name: copy.agent.statisticsMissing }),
    ).toBeVisible();
    // The banner is the first thing on the tab: it stands over the result.
    expect(
      row.compareDocumentPosition(screen.getByTestId("seo-agent-verdict")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Sync statistics"]);
    // The dialog opens on this banner's source.
    await userEvent.click(within(row).getByRole("button"));
    expect(
      within(
        await screen.findByRole("dialog", { name: "Sync statistics" }),
      ).getByRole("combobox", { name: "Source" }),
    ).toHaveTextContent("Search Console");
    // Without a source the dialog starts on the connected account too: on Google Analytics it had no sync.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await openStatisticsSetup(userEvent);
    const reopened = await screen.findByRole("dialog", {
      name: "Sync statistics",
    });
    await waitFor(() =>
      expect(
        within(reopened).getByRole("combobox", { name: "Source" }),
      ).toHaveTextContent("Search Console"),
    );
  });

  it("asks for the account on the Traffic tab while no account is connected", async () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace, "?tab=traffic");
    // The sentence names the button under it ("Set up statistics"), not the button of the Agent banner.
    expect(
      await screen.findByText(copy.overview.trafficSetupBody),
    ).toBeVisible();
    expect(
      screen.queryByText(copy.agent.steps.connect.search_console),
    ).toBeNull();
    // The answer "not connected" is in, so the text below is not the text of a pending read.
    await waitFor(() =>
      expect(
        clients
          .at(-1)
          ?.getQueryCache()
          .findAll({ queryKey: ["seo-connection"] })
          .some((query) => query.state.data !== undefined),
      ).toBe(true),
    );
    expect(screen.queryByText(copy.overview.trafficSyncBody)).toBeNull();
    // One card and one button ask for the account: no second empty card for Search Console.
    expect(screen.queryByText(copy.queries.notConnected)).toBeNull();
    const setUp = screen.getAllByRole("button", {
      name: copy.overview.manageConnections,
    });
    expect(setUp).toHaveLength(1);
    // A check can start and no action waits, so the header's run button is the filled one: the view keeps one.
    expect(setUp[0]).not.toHaveClass("bg-primary");
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(1);
  });

  it("puts a failed check on its own step, with the button that runs it again", () => {
    const workspace = seoTestWorkspace();
    workspace.analyses = [
      {
        id: "a1",
        kind: "page_check",
        status: "failed",
        taskId: null,
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
    ];
    network(workspace);
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    const steps = within(setup).getAllByRole("listitem");
    expect(within(steps[1]).getByText(copy.setup.checkFailed)).toBeVisible();
    expect(primaryButtons(setup)).toEqual(["Run full audit"]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
  });

  it("keeps keyboard focus on the check button when the check starts to run, and says when it started and how far it is", () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    const client = page(setupCard(workspace));
    const view = render(client);
    const button = screen.getByRole("button", { name: "Run full audit" });
    button.focus();
    const running = seoTestWorkspace();
    const check = {
      id: "a1",
      kind: "audit_full" as const,
      status: "running" as const,
      taskId: null,
      pageIds: running.scope.pageIds,
      scopeVersion: 2,
      createdAt: new Date(),
    };
    running.analyses = [check];
    view.rerender(page(setupCard(running)));
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Check running")).toBeVisible();
    // Core gives a start time and no progress. A first full audit of one page has the default time limit
    // (16 minutes) and the steps after it (5 minutes): the card says the time left, as an estimate.
    expect(
      screen.getByText("Started just now. About 21 minutes left (estimate)."),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", {
        name: "Progress of the check (estimate)",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    const at = (minutes: number, kind: "audit_full" | "page_check") => {
      const earlier = seoTestWorkspace();
      earlier.analyses = [
        {
          ...check,
          kind,
          createdAt: new Date(Date.now() - minutes * 60_000),
        },
      ];
      view.rerender(page(setupCard(earlier)));
    };
    at(12, "audit_full");
    expect(
      screen.getByText(
        "Started 12 minutes ago. About 9 minutes left (estimate).",
      ),
    ).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "57",
    );
    // Past the usual time the bar does not fill and the words promise no time.
    at(30, "audit_full");
    expect(
      screen.getByText("Started 30 minutes ago. It takes longer than usual."),
    ).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "95",
    );
    // A first page check has no usual time: the card invents no share and no time left.
    at(12, "page_check");
    expect(screen.getByText("Started 12 minutes ago.")).toBeVisible();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("starts no second check while one runs: the press opens no form", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    network(workspace);
    const view = render(
      page(<SeoWorkspace workspace={workspace} />, "?tab=actions"),
    );
    // Without a check in flight the empty Actions tab opens the check form.
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    view.unmount();
    const running = seoTestWorkspace();
    running.analyses = [
      {
        id: "a1",
        kind: "audit_full",
        status: "running",
        taskId: null,
        pageIds: running.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date(),
      },
    ];
    network(running);
    render(page(<SeoWorkspace workspace={running} />, "?tab=actions"));
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the runs of the site over the tabs, and the page of an older run on a press", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const run = (observedAt: string, issues: number) => ({
      observationId: crypto.randomUUID(),
      kind: "audit_full",
      observedAt: new Date(observedAt),
      issues,
      seconds: 600,
    });
    // One run is no choice: no row.
    workspace.runs = [run("2026-11-12T13:00:00Z", 5)];
    network(workspace);
    const view = render(page(<SeoWorkspace workspace={workspace} />));
    expect(screen.queryByRole("group", { name: "Audit runs" })).toBeNull();
    view.unmount();
    workspace.runs.push(run("2026-11-10T09:00:00Z", 6));
    render(page(<SeoWorkspace workspace={workspace} />));
    const runs = within(screen.getByRole("group", { name: "Audit runs" }));
    const newest = runs.getByRole("button", { name: "Nov 12 5 issues" });
    const older = runs.getByRole("button", { name: "Nov 10 6 issues" });
    expect(newest).toHaveAttribute("aria-pressed", "true");
    expect(older).toHaveAttribute("aria-pressed", "false");
    await user.click(older);
    await waitFor(() => expect(older).toHaveAttribute("aria-pressed", "true"));
    expect(newest).toHaveAttribute("aria-pressed", "false");
    // The row shows the pick: the date fields stay closed.
    expect(document.getElementById("seo-period-from")).toBeNull();
    // The newest run is the page without a date.
    await user.click(newest);
    await waitFor(() => expect(newest).toHaveAttribute("aria-pressed", "true"));
  });

  it("says why checks are off in the notice, with no setup card that promises a check", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    network(workspace);
    renderWorkspace(workspace);
    expect(screen.queryByTestId("seo-setup")).toBeNull();
    expect(screen.getByText(copy.dispatchPaused)).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(screen.getByText(copy.dispatchPaused)).toBeVisible();
  });

  it("ends setup for a filtered view, which keeps the notice", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    network(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.scope.pageIds[0]}`);
    expect(screen.queryByTestId("seo-setup")).toBeNull();
    expect(screen.getByText(copy.dispatchPaused)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run a check" })).toBeNull();
    // The headline does not ask for a check that cannot run here.
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      /^No check yet$/,
    );
  });

  it.each([
    [true, copy.keywords.emptyBody, copy.competitors.emptyBody],
    [false, copy.keywords.emptyBodyOff, copy.competitors.emptyBodyOff],
  ])(
    "names a check in the empty rankings only where a check can run: %s",
    async (can, keywords, competitors) => {
      const workspace = seoTestWorkspace();
      workspace.availableActions.canRequestAnalysis = can;
      network(workspace);
      renderWorkspace(workspace, "?tab=rankings");
      expect(screen.getByText(keywords)).toBeVisible();
      await userEvent.click(
        screen.getByRole("button", { name: "Competitors" }),
      );
      expect(
        screen.getByRole("button", { name: "Competitors" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText(competitors)).toBeVisible();
    },
  );

  it("offers the Search Console searches where no keyword is tracked", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.searchQueries = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      observedAt: new Date("2026-10-29T00:00:00Z"),
      rowLimit: 250,
      truncated: false,
      rows: [
        {
          id: "solar",
          query: "solar battery",
          pageUrl: workspace.pages[0].url,
          clicks: 0,
          impressions: 1,
          ctr: 0,
          averagePosition: 3,
        },
      ],
    };
    network(workspace);
    renderWorkspace(workspace, "?tab=rankings");
    const offered = screen.getByTestId("seo-keyword-suggestions");
    expect(
      within(offered).getByText("Google already shows you for 1 search"),
    ).toBeVisible();
    expect(within(offered).getByText("Average position 3.0")).toBeVisible();
    // The offer replaces the empty text; it does not sit under it.
    expect(screen.queryByText(copy.keywords.empty)).toBeNull();
    await user.click(
      within(offered).getByRole("button", {
        name: "Track solar battery as a keyword",
      }),
    );
    expect(
      within(await screen.findByRole("dialog")).getByDisplayValue(
        "solar battery",
      ),
    ).toBeVisible();
  });

  it("leads with the search numbers and says once that checks are off", () => {
    const workspace = seoTestWorkspace();
    Object.assign(workspace.availableActions, {
      canRequestAnalysis: false,
      canCreateMonitor: false,
      canUsePaidSearchData: false,
    });
    workspace.metrics = [
      seoTestMetric(),
      {
        ...seoTestMetric(),
        id: "sync:impressions",
        key: "impressions",
        value: 35,
      },
    ];
    network(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.scope.pageIds[0]}`);
    // No check can run: the headline is what is known, and the line under it does not repeat it.
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      /^Google search on this page: 2 clicks, 35 impressions$/,
    );
    expect(screen.getByTestId("seo-agent-traffic")).toHaveTextContent(
      /^Jan 1\W+2, 2026\s*Open traffic$/,
    );
    // One notice above the tabs; no second line about schedules under the chat.
    expect(screen.getByText(copy.dispatchPaused)).toBeVisible();
    expect(screen.queryByTestId("seo-automation")).toBeNull();
  });

  it("offers the first check in a filtered view, which has no setup card", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.scope.pageIds[0]}`);
    expect(screen.queryByTestId("seo-setup")).toBeNull();
    expect(screen.getByTestId("seo-agent-verdict")).toHaveTextContent(
      /^No check yet\. Run one to find issues\.$/,
    );
    await user.click(screen.getByRole("button", { name: "Run a check" }));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
});

describe("SEO agent chat", () => {
  const turn = (question: string, response: string) => ({
    id: crypto.randomUUID(),
    question,
    response,
    status: "completed",
    actions: [],
    scope: { pageIds: [] },
    createdAt: new Date().toISOString(),
  });
  // An Audit with a finished check: the result card leads, not the setup card.
  const chatWorkspace = seoTestCheckedAudit;

  it("has no question field on the page while the setup card leads: the floating button opens the chat", async () => {
    const user = userEvent.setup();
    const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
    network(workspace, {});
    renderWorkspace(workspace);
    await screen.findByTestId("seo-setup");
    expect(screen.queryByLabelText("Your question")).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.chat.title }));
    expect(
      within(
        await screen.findByRole("dialog", { name: copy.chat.title }),
      ).getByLabelText("Your question"),
    ).toBeVisible();
  });

  it("offers the agent from one floating button on every tab, and reads no conversation before it is pressed", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    const reads = vi.fn();
    network(workspace, {
      chat: () => {
        reads();
        return Response.json({ sharing: "personal", turns: [] });
      },
    });
    renderWorkspace(workspace);
    // The result card has no question field: the button is the one way to the agent.
    await screen.findByTestId("seo-agent-verdict");
    expect(screen.queryByLabelText("Your question")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: copy.chat.title }),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Health" }));
    expect(
      screen.getAllByRole("button", { name: copy.chat.title }),
    ).toHaveLength(1);
    expect(reads).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: copy.chat.title }));
    expect(
      within(
        await screen.findByRole("dialog", { name: copy.chat.title }),
      ).getByLabelText("Your question"),
    ).toBeVisible();
    await waitFor(() => expect(reads).toHaveBeenCalled());
    // The sheet has no trigger of its own: the button gets the focus back when it closes.
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: copy.agent.ask }),
      ).toHaveFocus(),
    );
  });

  it("shows HTML tag names in a reply as text, and loads no image from it", async () => {
    const workspace = chatWorkspace();
    const saved = turn(
      "Title?",
      "The <title> is 82 characters. ![x](https://outside.example/p.png)",
    );
    // A newer Core can name a dialog this build does not have.
    Object.assign(saved, { actions: [{ kind: "dialog", dialog: "future" }] });
    network(workspace, {
      chat: () => Response.json({ sharing: "personal", turns: [saved] }),
    });
    renderWorkspace(workspace);
    const sheet = await openChat(userEvent.setup());
    expect(
      await within(sheet).findByText(/The <title> is 82 characters\./),
    ).toBeVisible();
    expect(document.querySelector("img[src*='outside.example']")).toBeNull();
  });

  it("sends on Enter, and starts a new line on Shift+Enter, an IME confirm or a touch keyboard", async () => {
    const workspace = chatWorkspace();
    const posts: string[] = [];
    const turns: ReturnType<typeof turn>[] = [];
    network(workspace, {
      chat: (init) => {
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        posts.push(JSON.parse(String(init.body)).question);
        turns.push(turn("First", "Answer one"));
        return Response.json(turns[0]);
      },
    });
    renderWorkspace(workspace);
    const box = within(await openChat(userEvent.setup())).getByLabelText(
      "Your question",
    );
    fireEvent.change(box, { target: { value: "First" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    // A text field starts no line on Ctrl+Enter by itself: the panel adds it.
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(box).toHaveValue("First\n");
    (box as HTMLTextAreaElement).setSelectionRange(2, 2);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(box).toHaveValue("Fi\nrst\n");
    // Safari reports the Enter that confirms a composition with this key code.
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    vi.mocked(window.matchMedia).mockImplementation(() => media(false));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(posts).toEqual([]);
    vi.mocked(window.matchMedia).mockImplementation((query) =>
      media(query === "(hover: hover)"),
    );
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Answer one")).toBeVisible();
    expect(posts).toEqual(["Fi\nrst"]);
  });

  it("shows a sent question in the thread at once, and gives it back to the field when the send fails", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    let answer: (response: Response) => void = () => {};
    network(workspace, {
      chat: (init) =>
        init?.method === "POST"
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : Response.json({ sharing: "personal", turns: [] }),
    });
    renderWorkspace(workspace);
    const sheet = await openChat(user);
    const box = within(sheet).getByLabelText("Your question");
    await user.type(box, "Why did clicks fall?");
    await user.click(
      within(sheet).getByRole("button", { name: "Send question" }),
    );
    // Core has not answered: the question is in the thread, and the field is empty.
    expect(
      await within(sheet).findByText("Reading audit results"),
    ).toBeVisible();
    expect(within(sheet).getByText("Why did clicks fall?")).toBeVisible();
    expect(box).toHaveValue("");
    expect(within(sheet).getByText(copy.chat.asked)).toBeInTheDocument();
    answer(new Response(null, { status: 500 }));
    await waitFor(() => expect(box).toHaveValue("Why did clicks fall?"));
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      copy.chat.failed,
    );
    expect(screen.queryByText("Reading audit results")).toBeNull();
  });

  it("asks about competitors only where the audit has one", async () => {
    const workspace = chatWorkspace();
    const rival = {
      id: "rival",
      url: "https://rival.example/",
      role: "competitor" as const,
      confirmed: true,
      source: "saved" as const,
      rank: null,
      backlinks: null,
      referringDomains: null,
      observedAt: null,
      observationId: null,
      version: 1,
      canConfirm: true,
      exclusionReason: null,
    };
    // The audited page's own row is in the same list; it is no competitor.
    workspace.competitors = [{ ...rival, id: "own", role: "page" }];
    network(workspace);
    renderWorkspace(workspace);
    const user = userEvent.setup();
    const sheet = await openChat(user);
    expect(
      await within(sheet).findByRole("button", {
        name: copy.agent.prompts.first,
      }),
    ).toBeVisible();
    expect(
      within(sheet).queryByRole("button", {
        name: copy.agent.prompts.competitors,
      }),
    ).toBeNull();
    cleanup();
    workspace.competitors.push(rival);
    renderWorkspace(workspace);
    expect(
      await within(await openChat(user)).findByRole("button", {
        name: copy.agent.prompts.competitors,
      }),
    ).toBeVisible();
  });

  it("sends a suggested question with one click in the chat sheet", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    const posts: string[] = [];
    const turns: ReturnType<typeof turn>[] = [];
    network(workspace, {
      chat: (init) => {
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        posts.push(JSON.parse(String(init.body)).question);
        turns.push(turn(posts[0], "Start with the title."));
        return Response.json(turns[0]);
      },
    });
    renderWorkspace(workspace);
    const sheet = await openChat(user);
    await user.click(
      await within(sheet).findByRole("button", {
        name: copy.agent.prompts.first,
      }),
    );
    expect(
      await within(sheet).findByText("Start with the title."),
    ).toBeVisible();
    expect(posts).toEqual([copy.agent.prompts.first]);
    // A keyboard is at hand: the next question can be typed at once.
    expect(within(sheet).getByLabelText("Your question")).toHaveFocus();
  });

  it("opens the sheet on a touch screen with focus on the thread, so no keyboard covers the answer", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    network(workspace, {});
    vi.mocked(window.matchMedia).mockImplementation(() => media(false));
    renderWorkspace(workspace);
    const sheet = await openChat(user);
    await waitFor(() =>
      expect(
        within(sheet).getByRole("group", { name: copy.chat.title }),
      ).toHaveFocus(),
    );
  });

  it("keeps a question in the field, unsent and across a close, while the agent still works on another", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    const running = { ...turn("Earlier", ""), status: "running" };
    let posts = 0;
    network(workspace, {
      chat: (init) => {
        if (init?.method === "POST") posts += 1;
        return Response.json({ sharing: "personal", turns: [running] });
      },
    });
    renderWorkspace(workspace);
    const first = await openChat(user);
    await within(first).findByText("Earlier");
    // A turn in flight takes no second question: Enter sends nothing.
    await user.type(
      within(first).getByLabelText("Your question"),
      "Half a thought{Enter}",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const sheet = await openChat(user);
    // Not sent and not lost.
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "Half a thought",
    );
    expect(posts).toBe(0);
  });

  it("does not announce the last reply for a later question that fails, and keeps both drafts", async () => {
    const user = userEvent.setup();
    const workspace = chatWorkspace();
    const turns: ReturnType<typeof turn>[] = [];
    let fail: (response: Response) => void = () => {};
    network(workspace, {
      chat: (init) => {
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns });
        if (turns.length)
          return new Promise<Response>((resolve) => {
            fail = resolve;
          });
        turns.push(turn("First", "Answer one"));
        return Response.json(turns[0]);
      },
    });
    renderWorkspace(workspace);
    const sheet = await openChat(user);
    const box = within(sheet).getByLabelText("Your question");
    await user.type(box, "First{Enter}");
    expect(await screen.findByText(copy.chat.replied)).toBeInTheDocument();
    await user.type(box, "Second{Enter}");
    await screen.findByText("Reading audit results");
    // The first reply is old news while the second question is out.
    expect(screen.queryByText(copy.chat.replied)).toBeNull();
    await user.type(box, "Third");
    fail(new Response(null, { status: 500 }));
    await waitFor(() => expect(box).toHaveValue("Second\nThird"));
    expect(screen.queryByText(copy.chat.replied)).toBeNull();
  });

  it("gives the question back at the daily limit, and says why a restored draft is too long to send", async () => {
    const workspace = chatWorkspace();
    let posts = 0;
    let limit: (response: Response) => void = () => {};
    network(workspace, {
      chat: (init) => {
        if (init?.method !== "POST")
          return Response.json({ sharing: "personal", turns: [] });
        posts += 1;
        return new Promise<Response>((resolve) => {
          limit = resolve;
        });
      },
    });
    renderWorkspace(workspace);
    const sheet = await openChat(userEvent.setup());
    const box = within(sheet).getByLabelText("Your question");
    const first = "a".repeat(2_500);
    const second = "b".repeat(2_500);
    fireEvent.change(box, { target: { value: first } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText(copy.chat.asked);
    fireEvent.change(box, { target: { value: second } });
    limit(new Response(null, { status: 429 }));
    // Neither draft is lost, though both together pass the limit.
    await waitFor(() => expect(box).toHaveValue(`${first}\n${second}`));
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      copy.chat.dailyLimit,
    );
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() =>
      expect(within(sheet).getByRole("alert")).toHaveTextContent(
        "over 4,000 characters",
      ),
    );
    expect(posts).toBe(1);
    // The reason leaves once the text fits again.
    fireEvent.change(box, { target: { value: first } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
