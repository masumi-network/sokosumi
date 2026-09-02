import { describe, expect, it } from "vitest";

import { selectSokoBotDirectDeliveryRoom } from "./soko-bot-chat.service";

describe("selectSokoBotDirectDeliveryRoom", () => {
  const older = new Date("2026-01-01T00:00:00.000Z");
  const newer = new Date("2026-02-01T00:00:00.000Z");

  it("prefers a personal legacy room with history over an empty org orchestrator room", () => {
    const selected = selectSokoBotDirectDeliveryRoom([
      {
        id: "orch_org_empty",
        organizationId: "org_1",
        updatedAt: newer,
        messageCount: 0,
        isOrchestrator: true,
      },
      {
        id: "legacy_personal",
        organizationId: null,
        updatedAt: older,
        messageCount: 12,
        isOrchestrator: false,
      },
    ]);
    expect(selected?.id).toBe("legacy_personal");
  });

  it("prefers personal orchestrator over personal legacy when both have history", () => {
    const selected = selectSokoBotDirectDeliveryRoom([
      {
        id: "legacy_personal",
        organizationId: null,
        updatedAt: newer,
        messageCount: 3,
        isOrchestrator: false,
      },
      {
        id: "orch_personal",
        organizationId: null,
        updatedAt: older,
        messageCount: 3,
        isOrchestrator: true,
      },
    ]);
    expect(selected?.id).toBe("orch_personal");
  });

  it("returns null for an empty candidate list", () => {
    expect(selectSokoBotDirectDeliveryRoom([])).toBeNull();
  });
});
