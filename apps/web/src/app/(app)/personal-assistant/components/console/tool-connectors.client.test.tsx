import type {
  SokoBotIntegration,
  SokoBotIntegrationCatalogEntry,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        messages={messages}
        formats={createFormats("h12")}
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
