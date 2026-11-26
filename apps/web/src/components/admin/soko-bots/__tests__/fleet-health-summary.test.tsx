import type { AdminSokoBotListItem } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { FleetHealthSummary } from "../fleet-health-summary";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages: en, namespace } as never),
}));

const failing: AdminSokoBotListItem = {
  id: "bot_1",
  name: "Hero",
  status: "IDLE",
  archivedAt: null,
  versionId: "v36",
  kind: "assistant",
  runtimeVersion: null,
  runtimeDeployment: null,
  lastActivityAt: null,
  lastSucceededAt: null,
  lastFailedAt: null,
  consecutiveTurnFailures: 2,
  outOfCredits: false,
  turnCount: 9,
  pendingDecisionCount: 0,
  scheduleCount: 0,
  owner: { id: "u1", name: "Jami", email: "jami@example.com" },
  evalLane: false,
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  updatedAt: new Date("2026-11-25T10:00:00.000Z"),
};

describe("FleetHealthSummary", () => {
  it("shows Core's fleet-wide counts, not a page's", async () => {
    render(
      await FleetHealthSummary({
        summary: {
          active: 129,
          activeRecently: 31,
          pendingDecisions: 6,
          attention: [failing],
          attentionTotal: 14,
        },
      }),
    );

    expect(screen.getByText("129")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    // The total counts every bot that needs someone; the list shows the first.
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("Hero")).toBeTruthy();
    expect(screen.getByText("jami@example.com")).toBeTruthy();
  });
});
