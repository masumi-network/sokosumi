import type {
  SokoBotIntegration,
  SokoBotIntegrationCatalogEntry,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function renderConnectors(
  integrations: SokoBotIntegration[],
  focusProvider: string | null = null,
  readOnly = false,
  onError?: (error: Error) => void,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats("h12")}
        onError={onError}
      >
        <ToolConnectors
          integrations={{ configured: true, integrations }}
          focusProvider={focusProvider}
          readOnly={readOnly}
        />
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
});
