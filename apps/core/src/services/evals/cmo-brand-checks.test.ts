import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { strategyChecks } from "./cmo-brand-checks";
import { CMO_EVAL_BRANDS } from "./eval-cmo-cases";

function checks(name: string, patch: Partial<MarketingStrategyPlan> = {}) {
  const brand = CMO_EVAL_BRANDS.find((brand) => brand.name === name);
  if (!brand) throw new Error(`Missing eval brand ${name}`);
  return strategyChecks(brand, {
    month: "2026-11",
    summary: "Show a clear path to getting started.",
    goals: ["More customers"],
    pillars: [],
    channels: [],
    calendar: [],
    offer: {
      what: "14-day free trial",
      why: "Try before buying",
      action: "Start trial",
    },
    contentLanguage: "English",
    ...patch,
  }).checks;
}

describe("strategyChecks", () => {
  it.each([
    { ladder: { core: { what: "Custom AI CoWorker" } } },
    {
      idea: {
        who: "Teams",
        position: "Finish work",
        attract: "Search",
        offer: "A demo",
        sentence: "Try a custom AI CoWorker in your workflow.",
      },
    },
    { positioning: "Custom AI CoWorkers for recurring work" },
  ])(
    "recognizes the main product outside a generic entry offer: %j",
    (patch) => {
      expect(checks("utxo.ag", patch)).toContainEqual(
        expect.objectContaining({ label: "Sells the main offer", pass: true }),
      );
    },
  );

  it("rejects a side product in the core offer despite a generic trial", () => {
    const result = checks("utxo.ag", {
      ladder: { core: { what: "Lead research CoWorker" } },
    });
    expect(result).toContainEqual(
      expect.objectContaining({
        label: "Does not sell a side product",
        pass: false,
        actual: "Core: Lead research CoWorker; entry: 14-day free trial",
      }),
    );
  });

  it("still rejects a side product promoted as the entry offer", () => {
    expect(
      checks("utxo.ag", {
        ladder: { core: { what: "Custom AI CoWorker" } },
        offer: {
          what: "Lead research",
          why: "Find buyers",
          action: "Start trial",
          proof: [],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        label: "Does not sell a side product",
        pass: false,
      }),
    );
  });

  it("does not mistake a calendar mention or generic trial for the main offer", () => {
    const result = checks("utxo.ag", {
      calendar: [
        {
          id: "side",
          date: "2026-11-12",
          channel: "x",
          format: "post",
          title: "A CoWorker side campaign",
          status: "idea",
        },
      ],
    });
    expect(result).toContainEqual(
      expect.objectContaining({
        label: "Sells the main offer",
        pass: false,
        actual: expect.stringContaining(
          "Core: missing; entry: 14-day free trial; headline:",
        ),
      }),
    );
  });

  it.each([
    [
      "Mailchimp",
      "Die vier Wochen machen E-Mail- und SMS-Pläne verständlicher, zeigen saisonale Anwendungen und führen Interessenten zum passenden Einstieg.",
    ],
    [
      "lemlist",
      "Explain the Email plan, answer cost and setup concerns, and turn year-end outbound searches into trial starts.",
    ],
  ])("accepts the saved %s product wording", (name, summary) => {
    expect(checks(name, { summary })).toContainEqual(
      expect.objectContaining({ label: "Sells the main offer", pass: true }),
    );
  });

  it("keeps the language failure separate from valid German email wording", () => {
    const result = checks("Mailchimp", {
      summary: "E-Mail- und SMS-Pläne",
      contentLanguage: "German",
    });
    expect(result).toContainEqual(
      expect.objectContaining({ label: "Sells the main offer", pass: true }),
    );
    expect(result).toContainEqual({
      label: "Posts in english",
      pass: false,
      actual: "German",
    });
  });

  it.each(["Mailchimp", "lemlist"])(
    "rejects a generic trial without a core product for %s",
    (name) => {
      expect(checks(name)).toContainEqual(
        expect.objectContaining({ label: "Sells the main offer", pass: false }),
      );
    },
  );
});
