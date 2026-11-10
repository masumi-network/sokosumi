import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { strategyChecks } from "./cmo-brand-checks";
import { CMO_EVAL_BRANDS } from "./eval-cmo-cases";

const brand = CMO_EVAL_BRANDS[0];

describe("strategyChecks", () => {
  it("fails a plan that breaks a hard rule, which the save now keeps", () => {
    const saved = {
      month: "2026-11",
      summary: `${brand.name} for busy teams.`,
      goals: ["More sign-ups"],
      pillars: [{ name: "Setup", share: 100 }],
      mix: [{ approach: "educational", share: 100, why: "Teach" }],
      channels: [{ channel: "linkedin", cadence: "1 a week" }],
      calendar: [
        {
          id: "a",
          date: "2026-11-02",
          time: "09:00",
          channel: "linkedin",
          format: "text",
          title: "One piece",
          status: "idea",
          approach: "educational",
          pillar: "Setup",
        },
      ],
    };
    const { strategy, checks } = strategyChecks(brand, saved);
    expect(strategy).not.toBeNull();
    const rules = checks.find(
      (check) => check.label === "Keeps the strategy skill's rules",
    );
    expect(rules?.pass).toBe(false);
    expect(rules?.actual).toMatch(/Rule "16 pieces"/);
  });
});
