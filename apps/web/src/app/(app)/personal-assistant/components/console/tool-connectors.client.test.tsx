import type {
  SokoBotIntegration,
  SokoBotIntegrationCatalogEntry,
} from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../../messages/en.json";
import { ToolConnectors } from "./tool-connectors.client";

vi.mock("@/lib/actions/soko-bot/action", () => ({
  connectSokoBotIntegrationAction: vi.fn(),
  disconnectSokoBotIntegrationAction: vi.fn(),
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

function renderConnectors(integrations: SokoBotIntegration[]) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={messages}
      formats={createFormats("h12")}
    >
      <ToolConnectors
        integrations={{ configured: true, integrations }}
        catalog={catalog}
        onBrowseAll={() => {}}
      />
    </NextIntlClientProvider>,
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

  it("adds six popular apps that are not listed yet", () => {
    renderConnectors([integration({ provider: "gmail", name: "Gmail" })]);

    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByText("slack")).toBeTruthy();
    expect(screen.queryByText("figma")).toBeNull();
  });
});
