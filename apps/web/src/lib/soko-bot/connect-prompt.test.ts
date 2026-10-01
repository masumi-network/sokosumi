import type { SokoBotIntegrations } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { connectOffers } from "./connect-prompt";

function integration(
  provider: string,
  kinds: ("email" | "calendar")[],
  status: SokoBotIntegrations["integrations"][number]["status"],
): SokoBotIntegrations["integrations"][number] {
  return {
    provider,
    name: provider,
    logoUrl: null,
    kinds,
    status,
    connectedAt: null,
    lastIngestAt: null,
  } as SokoBotIntegrations["integrations"][number];
}

describe("connectOffers", () => {
  it("offers Gmail, Google Calendar and Teams while nothing is connected", () => {
    expect(
      connectOffers([
        integration("gmail", ["email"], "DISCONNECTED"),
        integration("googlecalendar", ["calendar"], "DISCONNECTED"),
      ]),
    ).toEqual([
      { provider: "gmail", name: "Gmail", connected: false },
      { provider: "googlecalendar", name: "Google Calendar", connected: false },
      {
        provider: "microsoft_teams",
        name: "Microsoft Teams",
        connected: false,
      },
    ]);
  });

  it("marks what is connected and stays while calendar is missing", () => {
    expect(
      connectOffers([
        integration("gmail", ["email"], "ACTIVE"),
        integration("googlecalendar", ["calendar"], "FAILED"),
        integration("microsoft_teams", [], "ACTIVE"),
      ]),
    ).toEqual([
      { provider: "gmail", name: "Gmail", connected: true },
      { provider: "googlecalendar", name: "Google Calendar", connected: false },
      { provider: "microsoft_teams", name: "Microsoft Teams", connected: true },
    ]);
  });

  it("hides once mail and calendar are both covered, by any provider", () => {
    expect(
      connectOffers([integration("outlook", ["email", "calendar"], "ACTIVE")]),
    ).toEqual([]);
  });
});
