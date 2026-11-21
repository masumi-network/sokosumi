import type {
  SokoBotIntegration,
  SokoBotIntegrationCatalogEntry,
} from "@sokosumi/core-client";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchablePageContent } from "@/components/searchable-page-content";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../../messages/en.json";
import { ToolConnectors } from "./tool-connectors.client";

const { searchCatalog } = vi.hoisted(() => ({ searchCatalog: vi.fn() }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  connectSokoBotIntegrationAction: vi.fn(),
  disconnectSokoBotIntegrationAction: vi.fn(),
  searchSokoBotIntegrationCatalogAction: searchCatalog,
}));

function integration(
  overrides: Partial<SokoBotIntegration> & { provider: string },
): SokoBotIntegration {
  return {
    name: overrides.provider,
    logoUrl: null,
    kinds: [],
    status: "DISCONNECTED",
    connectedAt: null,
    lastIngestAt: null,
    lastError: null,
    ...overrides,
  };
}

const catalog: SokoBotIntegrationCatalogEntry[] = [
  "gmail",
  "slack",
  "notion",
  "linear",
  "github",
  "googledrive",
  "microsoft_teams",
  "figma",
].map((provider) => ({
  provider,
  name: provider,
  description: null,
  logoUrl: null,
  kinds: [],
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  searchCatalog.mockImplementation(async ({ query }: { query: string }) => ({
    ok: true,
    value: catalog.filter((entry) => entry.provider.includes(query)),
  }));
});

afterEach(() => {
  onlineManager.setOnline(true);
  document.body.querySelector("#elsewhere")?.remove();
});

function renderConnectors(
  integrations: SokoBotIntegration[],
  focusProvider: string | null = null,
  readOnly = false,
  onError?: (error: Error) => void,
  client = new QueryClient(),
  withPageSearch = false,
) {
  const connectors = (
    <ToolConnectors
      integrations={{ configured: true, integrations }}
      focusProvider={focusProvider}
      readOnly={readOnly}
    />
  );
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats("h12")}
        onError={onError}
      >
        {withPageSearch ? (
          <SearchablePageContent>{connectors}</SearchablePageContent>
        ) : (
          connectors
        )}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ToolConnectors", () => {
  it("offers Manage on working connections and Connect on the rest", () => {
    renderConnectors([
      integration({
        provider: "googlecalendar",
        name: "Google Calendar",
        kinds: ["calendar"],
        status: "ACTIVE",
      }),
      integration({ provider: "gmail", name: "Gmail", kinds: ["email"] }),
    ]);

    expect(
      screen.getByRole("button", { name: "Manage Google Calendar" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
    // A calendar is read on demand, so it never promises a 15-minute check.
    expect(
      screen.getByText("Connected · read when a briefing or meeting needs it"),
    ).toBeTruthy();
  });

  it("says when a connection last checked without a next-intl fallback", () => {
    const onError = vi.fn();
    renderConnectors(
      [
        integration({
          provider: "gmail",
          name: "Gmail",
          kinds: ["email"],
          status: "ACTIVE",
          lastIngestAt: new Date(Date.now() - 60 * 60_000),
        }),
      ],
      null,
      false,
      onError,
    );

    expect(screen.getByText("Connected · checked 1 hour ago")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it("asks for a reconnect when a connection broke", () => {
    renderConnectors([
      integration({ provider: "gmail", name: "Gmail", status: "FAILED" }),
    ]);

    expect(
      screen.getByRole("button", { name: "Reconnect Gmail" }),
    ).toBeTruthy();
  });

  it("adds six popular apps that are not listed yet", async () => {
    renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);

    expect(await screen.findByText("slack")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByText("figma")).toBeNull();
  });

  it("searches every app, past the popular ones", async () => {
    const user = userEvent.setup();
    renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);

    await user.type(screen.getByRole("searchbox"), "fig");
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    expect(screen.getByRole("button", { name: "Connect figma" })).toBeTruthy();
  });

  it("uses one dashboard field for a linked provider and for catalog matches beyond the popular suggestions", async () => {
    const user = userEvent.setup();
    renderConnectors([], "figma", false, undefined, new QueryClient(), true);
    const field = screen.getByRole("searchbox");
    expect(field).toHaveValue("figma");
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "teams");
    expect(
      await screen.findByRole("button", { name: "Connect microsoft_teams" }),
    ).toBeInTheDocument();
  });

  it("opens a bot's connect link on that app", async () => {
    renderConnectors([], "figma");

    expect(screen.getByRole("searchbox")).toHaveValue("figma");
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
  });

  it("shows placeholder cards for the new search, not the last list", async () => {
    const user = userEvent.setup();
    let finish = (_value: unknown) => {};
    renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);
    expect(await screen.findByText("slack")).toBeTruthy();
    searchCatalog.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );

    await user.type(screen.getByRole("searchbox"), "fig");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Searching apps for “fig”…");
    expect(screen.queryByText("slack")).toBeNull();
    expect(screen.queryByText("Nothing found.")).toBeNull();
    expect(
      screen.getAllByTestId("connector-placeholder").length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith({ query: "fig" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("“fig”");
    finish({ ok: true, value: catalog.filter((e) => e.provider === "figma") });
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("connector-placeholder")).toBeNull();
  });

  it("keeps a slow answer for an old search off the new one", async () => {
    const user = userEvent.setup();
    let finishFig = (_value: unknown) => {};
    searchCatalog.mockImplementation(({ query }: { query: string }) =>
      query === "fig"
        ? new Promise((resolve) => (finishFig = resolve))
        : Promise.resolve({
            ok: true,
            value: catalog.filter((e) => e.provider.includes(query)),
          }),
    );
    renderConnectors([]);
    const search = screen.getByRole("searchbox");

    await user.type(search, "fig");
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith({ query: "fig" }),
    );
    await user.clear(search);
    await user.type(search, "lin");
    expect(
      await screen.findByRole("button", { name: "Connect linear" }),
    ).toBeTruthy();
    finishFig({
      ok: true,
      value: catalog.filter((e) => e.provider === "figma"),
    });

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    expect(screen.queryByText("figma")).toBeNull();
  });

  it("says a failed search failed, and Try again searches again", async () => {
    const user = userEvent.setup();
    renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);
    searchCatalog.mockResolvedValue({ ok: false, error: "down" });

    await user.type(screen.getByRole("searchbox"), "fig");

    const failure = await screen.findByTestId("app-search-error");
    expect(failure).toHaveTextContent("Couldn't search apps.");
    expect(screen.queryByText("Nothing found.")).toBeNull();
    searchCatalog.mockResolvedValue({
      ok: true,
      value: catalog.filter((e) => e.provider === "figma"),
    });
    await user.click(
      within(failure).getByRole("button", { name: "Try again" }),
    );
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("app-search-error")).toBeNull();
  });

  it("shows a failed refresh of an old search, not its old cards", async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    renderConnectors([], null, false, undefined, client);
    const search = screen.getByRole("searchbox");
    await user.type(search, "fig");
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
    await user.clear(search);
    await screen.findByText("slack");
    // Five minutes later the old answer is stale and Core is down.
    await client.invalidateQueries();
    let fail = (_value: unknown) => {};
    searchCatalog.mockImplementation(
      () => new Promise((resolve) => (fail = resolve)),
    );

    searchCatalog.mockClear();
    await user.type(search, "fig");
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith({ query: "fig" }),
    );
    // The refresh is running: the old cards wait behind the placeholder.
    expect(screen.getByRole("status")).toHaveTextContent("“fig”");
    expect(screen.queryByText("figma")).toBeNull();
    fail({ ok: false, error: "down" });

    expect(await screen.findByTestId("app-search-error")).toBeTruthy();
    expect(screen.queryByText("figma")).toBeNull();
  });

  it("keeps keyboard focus on Try again while it runs and through another failure", async () => {
    const user = userEvent.setup();
    renderConnectors([]);
    searchCatalog.mockResolvedValue({ ok: false, error: "down" });
    await user.type(screen.getByRole("searchbox"), "fig");
    const retry = within(
      await screen.findByTestId("app-search-error"),
    ).getByRole("button", { name: "Try again" });
    let answer = (_value: unknown) => {};
    searchCatalog.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    retry.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    answer({ ok: false, error: "down" });
    await waitFor(() => expect(retry).not.toHaveAttribute("aria-busy"));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();

    await user.keyboard("{Enter}");
    answer({ ok: true, value: catalog.filter((e) => e.provider === "figma") });
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
  });

  it("takes no more than the 100 characters a search allows", async () => {
    const user = userEvent.setup();
    renderConnectors([]);
    const search = screen.getByRole("searchbox");

    await user.click(search);
    await user.paste("a".repeat(101));

    expect(search).toHaveValue("a".repeat(100));
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith({ query: "a".repeat(100) }),
    );
    expect(await screen.findByText("Nothing found.")).toBeTruthy();
    expect(screen.queryByTestId("app-search-error")).toBeNull();
  });

  it("waits offline instead of saying nothing matched, and searches once back", async () => {
    vi.useFakeTimers();
    try {
      renderConnectors([]);
      act(() => onlineManager.setOnline(false));

      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "fig" },
      });
      await act(async () => vi.advanceTimersByTimeAsync(250));

      expect(screen.getByRole("status")).toHaveTextContent("“fig”");
      expect(screen.queryByText("Nothing found.")).toBeNull();
      expect(searchCatalog).not.toHaveBeenCalledWith({ query: "fig" });
    } finally {
      vi.useRealTimers();
    }
    act(() => onlineManager.setOnline(true));
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
  });

  it("keeps a retry made offline busy on its banner, not an empty answer", async () => {
    const user = userEvent.setup();
    renderConnectors([]);
    searchCatalog.mockResolvedValue({ ok: false, error: "down" });
    await user.type(screen.getByRole("searchbox"), "fig");
    const retry = within(
      await screen.findByTestId("app-search-error"),
    ).getByRole("button", { name: "Try again" });
    searchCatalog.mockResolvedValue({
      ok: true,
      value: catalog.filter((e) => e.provider === "figma"),
    });
    act(() => onlineManager.setOnline(false));

    await user.click(retry);

    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(screen.queryByText("Nothing found.")).toBeNull();
    act(() => onlineManager.setOnline(true));
    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
  });

  it("never moves focus when a pointer retry finds results", async () => {
    const user = userEvent.setup();
    renderConnectors([]);
    searchCatalog.mockResolvedValue({ ok: false, error: "down" });
    await user.type(screen.getByRole("searchbox"), "fig");
    const retry = within(
      await screen.findByTestId("app-search-error"),
    ).getByRole("button", { name: "Try again" });
    let answer = (_value: unknown) => {};
    searchCatalog.mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    const elsewhere = document.body.appendChild(
      document.createElement("button"),
    );
    elsewhere.id = "elsewhere";

    await user.click(retry);
    await waitFor(() => expect(searchCatalog).toHaveBeenCalled());
    elsewhere.focus();
    answer({ ok: true, value: catalog.filter((e) => e.provider === "figma") });

    expect(
      await screen.findByRole("button", { name: "Connect figma" }),
    ).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole("searchbox")).not.toHaveFocus();
  });

  it("caps a connect link's search at the same 100 characters", async () => {
    renderConnectors([], "b".repeat(101));

    expect(screen.getByRole("searchbox")).toHaveValue("b".repeat(100));
    await waitFor(() =>
      expect(searchCatalog).toHaveBeenCalledWith({ query: "b".repeat(100) }),
    );
    expect(searchCatalog).not.toHaveBeenCalledWith({ query: "b".repeat(101) });
  });

  it("says nothing matched only when the search worked", async () => {
    const user = userEvent.setup();
    renderConnectors([]);

    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(await screen.findByText("Nothing found.")).toBeTruthy();
    expect(screen.queryByTestId("app-search-error")).toBeNull();
    expect(screen.queryByTestId("connector-placeholder")).toBeNull();
  });

  it("shows a read-only bot's apps with no Connect, Manage or search", async () => {
    renderConnectors(
      [
        integration({
          provider: "googlecalendar",
          name: "Google Calendar",
          status: "ACTIVE",
        }),
        integration({ provider: "gmail", name: "Gmail" }),
      ],
      // A bot's connect link must not search away its own apps.
      "figma",
      true,
    );

    expect(screen.getByText("Google Calendar")).toBeTruthy();
    expect(screen.getByText("Gmail")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    // Unconnected popular apps would only invite a connect Core refuses.
    await waitFor(() => expect(searchCatalog).not.toHaveBeenCalled());
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("debounces catalog searches by 250ms and resets on new input", async () => {
    vi.useFakeTimers();
    try {
      renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      searchCatalog.mockClear();

      const input = screen.getByRole("searchbox");
      fireEvent.change(input, { target: { value: "fi" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(searchCatalog).not.toHaveBeenCalled();

      // Another keystroke before 250ms resets the debounce window.
      fireEvent.change(input, { target: { value: "fig" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(249);
      });
      expect(searchCatalog).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(searchCatalog).toHaveBeenCalledTimes(1);
      expect(searchCatalog).toHaveBeenCalledWith({ query: "fig" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not scroll again on an identical catalog refetch with a newer dataUpdatedAt", async () => {
    const client = new QueryClient();
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;

    renderConnectors([], "slack", false, undefined, client);

    await screen.findByRole("button", { name: "Connect slack" });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: "center" });

    const queryKey = ["soko-bot-integration-catalog", "slack"];
    const firstState = client.getQueryState(queryKey);
    const firstData = firstState?.data;
    const firstUpdatedAt = firstState?.dataUpdatedAt ?? 0;

    scrollSpy.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await act(async () => {
      await client.refetchQueries({ queryKey });
    });
    await screen.findByRole("button", { name: "Connect slack" });

    const nextState = client.getQueryState(queryKey);
    expect(searchCatalog).toHaveBeenCalledTimes(2);
    expect(nextState?.data).toBe(firstData);
    expect(nextState?.dataUpdatedAt).toBeGreaterThan(firstUpdatedAt);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
