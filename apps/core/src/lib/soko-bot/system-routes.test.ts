import {
  capabilitiesForClassification,
  SOKO_BOT_SYSTEM_SCHEDULES,
} from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { presetClassificationResult } from "@/lib/soko-bot/classifier";
import {
  SYSTEM_TURN_ROUTES,
  systemScheduleRoute,
} from "@/lib/soko-bot/system-routes";

describe("system turn routes", () => {
  it("gives every built-in rhythm a route", () => {
    for (const rhythm of SOKO_BOT_SYSTEM_SCHEDULES)
      expect(systemScheduleRoute(rhythm.key)).toBeDefined();
  });

  it("leaves owner-written schedules to Jev", () => {
    expect(systemScheduleRoute(null)).toBeUndefined();
    expect(systemScheduleRoute("toString")).toBeUndefined();
  });

  it.each(Object.entries(SYSTEM_TURN_ROUTES))(
    "never lets the %s turn hire",
    (_key, preset) => {
      const { classification } = presetClassificationResult("beat", preset);
      expect(capabilitiesForClassification(classification)).not.toContain(
        "hire_agent",
      );
    },
  );

  it("keeps the inbox check read-only and lets the briefing update memory", () => {
    const delta = presetClassificationResult(
      "mail",
      SYSTEM_TURN_ROUTES["ingest:delta"],
    ).classification;
    const briefing = presetClassificationResult(
      "mail",
      SYSTEM_TURN_ROUTES["ingest:briefing"],
    ).classification;
    expect(capabilitiesForClassification(delta)).not.toContain("update_memory");
    expect(capabilitiesForClassification(briefing)).toContain("update_memory");
    expect(capabilitiesForClassification(briefing)).not.toContain(
      "create_task",
    );
  });

  it("lets task-board and stand-up turns work Tasks", () => {
    for (const key of ["taskboard", "standup"] as const) {
      const capabilities = capabilitiesForClassification(
        presetClassificationResult("beat", SYSTEM_TURN_ROUTES[key])
          .classification,
      );
      expect(capabilities).toContain("reply_to_task");
      expect(capabilities).toContain("create_task");
    }
  });
});
