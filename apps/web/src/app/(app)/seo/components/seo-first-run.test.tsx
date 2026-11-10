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
import { SEO_TEST_AUDIT, seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

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

function renderWorkspace(workspace: ProjectSeoWorkspace, searchParams = "") {
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
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
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
    expect(
      within(setup).getByText("Next: Connect Search Console"),
    ).toBeVisible();
    await within(setup).findByRole("button", {
      name: "Connect Search Console",
    });
    expect(primaryButtons(setup)).toEqual(["Connect Search Console"]);
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
    await user.click(
      within(setup).getByRole("button", { name: "Sync statistics" }),
    );
    expect(await screen.findByRole("dialog")).toBeVisible();
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
    expect(within(steps[2]).getByText(copy.setup.checkFailed)).toBeVisible();
    await within(setup).findByRole("button", {
      name: "Connect Search Console",
    });
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
    expect(steps[2]).toHaveAttribute("aria-current", "step");
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
    // One per account: Search Console and Google Analytics.
    await waitFor(() =>
      expect(
        within(setup).getAllByRole("button", { name: "Sync statistics" }),
      ).toHaveLength(2),
    );
    expect(primaryButtons(setup)).toEqual(["Run a check"]);
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
  });

  it("offers the first check in a filtered view, which has no setup card", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    network(workspace);
    renderWorkspace(workspace, `?pageId=${workspace.scope.pageIds[0]}`);
    expect(screen.queryByTestId("seo-setup")).toBeNull();
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
    network(workspace, {
      chat: () => Response.json({ sharing: "personal", turns: [saved] }),
    });
    renderWorkspace(workspace);
    // The turn is from an earlier visit: open it.
    await userEvent
      .setup()
      .click(
        await screen.findByRole("button", { name: "Show 1 earlier question" }),
      );
    expect(
      await screen.findByText(/The <title> is 82 characters\./),
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
    expect(posts).toEqual(["First"]);
  });

  it("shows the question at once, and gives it back when the send fails", async () => {
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
    const box = await screen.findByLabelText("Your question");
    await user.type(box, "Why did clicks fall?");
    await user.click(screen.getByRole("button", { name: "Send question" }));
    // Core has not answered: the question is in the thread and the box is free.
    expect(await screen.findByText("Reading audit results")).toBeVisible();
    expect(screen.getByText("Why did clicks fall?")).toBeVisible();
    expect(box).toHaveValue("");
    answer(new Response(null, { status: 500 }));
    await waitFor(() => expect(box).toHaveValue("Why did clicks fall?"));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.chat.failed);
    expect(screen.queryByText("Reading audit results")).toBeNull();
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
    const box = await screen.findByLabelText("Your question");
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
});
