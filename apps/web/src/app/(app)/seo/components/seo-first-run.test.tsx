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
import { SEO_TEST_AUDIT, seoTestWorkspace } from "./seo-test-fixture";
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

/** The Agent tab holds no thread: the conversation opens in the sheet. */
async function openChat(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: copy.chat.openThread }),
  );
  return screen.findByRole("dialog", { name: copy.chat.title });
}

const primaryButtons = (scope: HTMLElement) =>
  within(scope)
    .getAllByRole("button")
    .filter((button) => button.className.split(" ").includes("bg-primary"))
    .map((button) => button.textContent);

beforeEach(() => {
  // A pointer device: Enter sends. A touch keyboard has its own test.
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) => ({ matches: query === "(hover: hover)" }) as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEO audit first run", () => {
  it("names one next action, and keeps it out of the list under the card", async () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    // The account's state is not read yet: the card names no next step and no state.
    expect(within(setup).queryByText(/^Next:/)).toBeNull();
    expect(
      within(setup).getByRole("heading", { name: "Google account" }),
    ).toBeVisible();
    await within(setup).findByRole("button", { name: "Connect Google" });
    // Still so with the status read: the account is not connected.
    expect(within(setup).getByText("Next: Connect Google")).toBeVisible();
    expect(primaryButtons(setup)).toEqual(["Connect Google"]);
    // One Google step: Analytics is a choice in it, not a second button.
    expect(
      within(setup).queryByRole("button", { name: "Connect Google Analytics" }),
    ).toBeNull();
    // The card offers the connections, so no row under it repeats them.
    expect(
      screen.queryByText(copy.agent.steps.connect.search_console),
    ).toBeNull();
    expect(screen.queryByText(copy.agent.steps.connect.ga4)).toBeNull();
  });

  it("offers the sync as the next action once the Google account is connected", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: provider === "search_console" ? "connected" : "not_connected",
        source: "native",
      }),
    });
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    await within(setup).findByText("Search Console connected");
    expect(primaryButtons(setup)).toEqual(["Sync statistics"]);
    expect(within(setup).getByText("Next: Sync statistics")).toBeVisible();
    expect(within(setup).getByText("2 of 4 done")).toBeVisible();
    const [, connect, sync] = within(setup).getAllByRole("listitem");
    // The account step is done and quiet: one line per account, no account action in the row.
    expect(
      within(connect).getByRole("heading", { name: "Google connected (done)" }),
    ).toBeVisible();
    expect(
      within(connect)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Search Console connected", "Connect Google Analytics"]);
    // The sync has its own step, and that step is the current one.
    expect(sync).toHaveAttribute("aria-current", "step");
    expect(
      within(sync).getByRole("heading", { name: "Sync statistics" }),
    ).toBeVisible();
    expect(within(sync).getByText(copy.setup.syncBody)).toBeVisible();
    await user.click(
      within(sync).getByRole("button", { name: "Sync statistics" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeVisible();
    // The dates in the fields are the 28-day preset, and its button says so.
    expect(
      within(dialog)
        .getAllByRole("button", { pressed: true })
        .map((button) => button.textContent),
    ).toEqual(["Last 28 days"]);
    await user.click(
      within(dialog).getByRole("button", { name: "Last 7 days" }),
    );
    expect(
      within(dialog)
        .getAllByRole("button", { pressed: true })
        .map((button) => button.textContent),
    ).toEqual(["Last 7 days"]);
  });

  it("does not ask for the account in a step that saved statistics have proved", async () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        id: "search-clicks",
        key: "clicks",
        label: "Clicks",
        unit: "count",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        value: 100,
        from: "2026-09-01",
        to: "2026-09-28",
        timeZone: "UTC",
        channel: "organic",
        observedAt: new Date("2026-10-01T10:00:00Z"),
        coverage: "complete",
        points: [],
        notes: [],
      },
    ];
    // The connection is per reader: this one has no account, or removed it after the sync.
    network(workspace);
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    const [, connect, sync] = within(setup).getAllByRole("listitem");
    await within(connect).findByRole("button", { name: "Connect Google" });
    expect(
      within(connect).getByRole("heading", { name: "Google account (done)" }),
    ).toBeVisible();
    expect(within(connect).queryByText(copy.setup.connectBody)).toBeNull();
    expect(
      within(sync).getByRole("heading", { name: "Statistics synced (done)" }),
    ).toBeVisible();
    expect(
      within(sync).getByRole("button", { name: copy.agent.openTraffic }),
    ).toBeVisible();
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
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
    expect(await screen.findByText(copy.queries.notSynced)).toBeVisible();
    expect(screen.getByText(copy.queries.notSyncedBody)).toBeVisible();
    expect(screen.getByText(copy.overview.trafficSyncBody)).toBeVisible();
    expect(screen.queryByText(copy.queries.notConnected)).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.queries.connect }),
    ).toBeNull();
    // Performance and the queries card each lead to the same sync.
    expect(
      screen.getAllByRole("button", { name: "Sync statistics" }),
    ).toHaveLength(2);
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
    // One action, like every other row: the account's menu is in the sync dialog.
    const row = text.closest("li");
    if (!row) throw new Error("no step row");
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Sync statistics"]);
    // The dialog opens on this row's source; without one it starts on Google Analytics.
    await userEvent.click(within(row).getByRole("button"));
    expect(
      within(
        await screen.findByRole("dialog", { name: "Sync statistics" }),
      ).getByRole("combobox", { name: "Source" }),
    ).toHaveTextContent("Search Console");
  });

  it("asks for the account on the Traffic tab while no account is connected", async () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace, "?tab=traffic");
    expect(await screen.findByText(copy.queries.notConnected)).toBeVisible();
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
    expect(screen.queryByText(copy.queries.notSynced)).toBeNull();
    expect(
      screen.getByRole("button", { name: copy.queries.connect }),
    ).toBeVisible();
  });

  it("puts a failed check on its own step, with the button that runs it again", async () => {
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
    expect(within(steps[3]).getByText(copy.setup.checkFailed)).toBeVisible();
    await within(setup).findByRole("button", { name: "Connect Google" });
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
    expect(steps[3]).toHaveAttribute("aria-current", "step");
  });

  it("keeps the sync in reach when a failed check holds the primary button", async () => {
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
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: "connected",
        source: "native",
      }),
    });
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    await within(setup).findByText("Google Analytics connected");
    // One sync, on its own step: the dialog has the choice of the source.
    expect(
      within(within(setup).getAllByRole("listitem")[2]).getByRole("button", {
        name: "Sync statistics",
      }),
    ).toBeEnabled();
    expect(
      within(setup).getAllByRole("button", { name: "Sync statistics" }),
    ).toHaveLength(1);
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
  });

  it("moves the next action to the check when the workspace cannot connect Google", async () => {
    const workspace = seoTestWorkspace();
    network(workspace, {
      connection: (provider) => ({
        provider,
        name: provider,
        status: "unavailable",
        source: "none",
      }),
    });
    renderWorkspace(workspace);
    const setup = screen.getByTestId("seo-setup");
    expect(
      await within(setup).findByText("Next: Run the first check"),
    ).toBeVisible();
    expect(
      within(setup).getByText(copy.setup.connectUnavailable),
    ).toBeVisible();
    expect(within(setup).getByText(copy.setup.syncUnavailable)).toBeVisible();
    expect(within(setup).getByText("1 of 2 done")).toBeVisible();
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
  });

  it("keeps keyboard focus on the check button when the check starts to run", () => {
    const workspace = seoTestWorkspace();
    network(workspace);
    const client = page(setupCard(workspace));
    const view = render(client);
    const button = screen.getByRole("button", { name: "Run a check" });
    button.focus();
    const running = seoTestWorkspace();
    running.analyses = [
      {
        id: "a1",
        kind: "page_check",
        status: "running",
        taskId: null,
        pageIds: running.scope.pageIds,
        scopeVersion: 2,
        createdAt: new Date("2026-01-02T12:00:00Z"),
      },
    ];
    view.rerender(page(setupCard(running)));
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Check running")).toBeVisible();
  });

  it("says why checks are off: on the check step during setup, in a notice elsewhere", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.availableActions.canRequestAnalysis = false;
    network(workspace);
    renderWorkspace(workspace);
    expect(screen.getByText(copy.setup.checkUnavailable)).toBeVisible();
    expect(screen.queryByText(copy.dispatchPaused)).toBeNull();
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
  const chatWorkspace = () => ({
    ...seoTestWorkspace(),
    auditId: SEO_TEST_AUDIT,
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
    const box = await screen.findByLabelText("Your question");
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
    vi.mocked(window.matchMedia).mockImplementation(
      () => ({ matches: false }) as MediaQueryList,
    );
    fireEvent.keyDown(box, { key: "Enter" });
    expect(posts).toEqual([]);
    vi.mocked(window.matchMedia).mockImplementation(
      (query) => ({ matches: query === "(hover: hover)" }) as MediaQueryList,
    );
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Answer one")).toBeVisible();
    expect(posts).toEqual(["Fi\nrst"]);
  });

  it("asks from the page in the chat sheet: the question shows at once, and its field gets it back when the send fails", async () => {
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
    const bar = await screen.findByLabelText("Your question");
    await user.type(bar, "Why did clicks fall?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    // Core has not answered: the sheet is open with the question in its thread.
    const sheet = await screen.findByRole("dialog", { name: copy.chat.title });
    expect(
      await within(sheet).findByText("Reading audit results"),
    ).toBeVisible();
    expect(within(sheet).getByText("Why did clicks fall?")).toBeVisible();
    const box = within(sheet).getByLabelText("Your question");
    expect(box).toHaveValue("");
    expect(bar).toHaveValue("");
    expect(within(sheet).getByText(copy.chat.asked)).toBeInTheDocument();
    answer(new Response(null, { status: 500 }));
    await waitFor(() => expect(box).toHaveValue("Why did clicks fall?"));
    expect(within(sheet).getByRole("alert")).toHaveTextContent(
      copy.chat.failed,
    );
    expect(screen.queryByText("Reading audit results")).toBeNull();
  });

  it("sends a suggested question from the page in the chat sheet", async () => {
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
    await user.click(
      await screen.findByRole("button", { name: copy.agent.prompts.first }),
    );
    const sheet = await screen.findByRole("dialog", { name: copy.chat.title });
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
    vi.mocked(window.matchMedia).mockImplementation(
      () => ({ matches: false }) as MediaQueryList,
    );
    renderWorkspace(workspace);
    const sheet = await openChat(user);
    await waitFor(() =>
      expect(
        within(sheet).getByRole("group", { name: copy.chat.title }),
      ).toHaveFocus(),
    );
  });

  it("keeps a question asked on the page in the sheet's field while the agent still works on another", async () => {
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
    // The sheet has read the chat once: it knows a turn is in flight.
    const first = await openChat(user);
    await within(first).findByText("Earlier");
    const typed = within(first).getByLabelText("Your question");
    await user.type(typed, "Half a thought");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.type(
      screen.getByLabelText("Your question"),
      "Second question{Enter}",
    );
    const sheet = await screen.findByRole("dialog", { name: copy.chat.title });
    // Not sent and not lost, after the text already in the field.
    expect(within(sheet).getByLabelText("Your question")).toHaveValue(
      "Half a thought\n\nSecond question",
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
