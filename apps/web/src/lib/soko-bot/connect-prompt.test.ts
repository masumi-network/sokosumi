import type { SokoBotIntegrations } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { missingConnections } from "./connect-prompt";

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

describe("missingConnections", () => {
  it("offers the first provider of each kind with nothing active", () => {
    expect(
      missingConnections([
        integration("gmail", ["email"], "DISCONNECTED"),
        integration("googlecalendar", ["calendar"], "DISCONNECTED"),
        integration("outlook", ["email", "calendar"], "DISCONNECTED"),
      ]),
    ).toEqual([
      { kind: "email", provider: "gmail", name: "gmail" },
      { kind: "calendar", provider: "googlecalendar", name: "googlecalendar" },
    ]);
  });

  it("drops a kind once any provider for it is active", () => {
    expect(
      missingConnections([
        integration("gmail", ["email"], "ACTIVE"),
        integration("googlecalendar", ["calendar"], "FAILED"),
      ]),
    ).toEqual([
      { kind: "calendar", provider: "googlecalendar", name: "googlecalendar" },
    ]);
  });

  it("offers nothing when both are covered", () => {
    expect(
      missingConnections([
        integration("outlook", ["email", "calendar"], "ACTIVE"),
      ]),
    ).toEqual([]);
  });
});
