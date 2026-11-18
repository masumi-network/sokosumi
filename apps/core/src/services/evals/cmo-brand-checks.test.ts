import type { MarketingStrategyPlan } from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { brandBrainChecks, strategyChecks } from "./cmo-brand-checks";
import { CMO_EVAL_BRANDS } from "./eval-cmo-cases";
import brains from "./fixtures/cmo-brand-brains.json";

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
  it("recognizes the main product in the core offer beside a generic entry offer", () => {
    expect(
      checks("utxo.ag", { ladder: { core: { what: "Custom AI CoWorker" } } }),
    ).toContainEqual(
      expect.objectContaining({ label: "Sells the main offer", pass: true }),
    );
  });

  it("does not take the positioning's category for what the plan sells", () => {
    expect(
      checks("utxo.ag", {
        positioning: "Custom AI CoWorkers for recurring work",
      }),
    ).toContainEqual(
      expect.objectContaining({ label: "Sells the main offer", pass: false }),
    );
  });

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

  it("fails German posts under English calendar titles", () => {
    const calendar = (titles: string[]) =>
      titles.map((title, index) => ({
        id: `e${index}`,
        date: "2026-11-20",
        channel: "instagram",
        format: "image",
        title,
        status: "idea" as const,
      }));
    const label = "Calendar titles in the posts' language";
    expect(
      checks("Hiltl", {
        contentLanguage: "German",
        calendar: calendar([
          "Choose your first Haus Hiltl buffet format",
          "Plan dinner around Zurich’s Christmas lights",
        ]),
      }),
    ).toContainEqual(
      expect.objectContaining({
        label,
        pass: false,
        actual: expect.stringContaining("0 of 2 titles"),
      }),
    );
    expect(
      checks("Hiltl", {
        contentLanguage: "German",
        calendar: calendar([
          "Zwei Buffetarten, eine klare Wahl",
          "Buffet nach Gewicht, kurz erklärt",
          "Hiltl Tartare, frisch serviert",
        ]),
      }),
    ).toContainEqual(expect.objectContaining({ label, pass: true }));
    expect(checks("cal.com").map((check) => check.label)).not.toContain(label);
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

const brand = CMO_EVAL_BRANDS[0];

describe("strategyChecks hard rules", () => {
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

const brain = (brains as Record<string, Record<string, unknown>>)["cal.com"];
const begin = {
  name: "Begin",
  url: "https://begin.is/",
  goal: "More users",
  main: "wallet",
  price: "^free(?!.*(ios|android|chrome|may apply))",
  profile: "x\\.com/beginwallet",
};

function failed(body: unknown) {
  return brandBrainChecks(begin, body)
    .checks.filter((check) => !check.pass)
    .map((check) => check.label);
}

describe("Brand Brain checks for a brand's price and profile", () => {
  it("passes when the main offer has the published price and the profile is listed", () => {
    expect(
      failed({
        ...brain,
        summary: "Begin is a free Cardano wallet.",
        offers: [{ name: "Begin Wallet", what: "A wallet", price: "Free" }],
        channels: [{ name: "X", url: "https://x.com/BeginWallet" }],
      }),
    ).toEqual([]);
  });

  it("fails a price narrowed to one store or hedged", () => {
    for (const price of ["Free iOS download", "Free; fees may apply"])
      expect(
        failed({
          ...brain,
          summary: "Begin is a free Cardano wallet.",
          offers: [{ name: "Begin Wallet", what: "A wallet", price }],
          channels: [{ name: "X", url: "https://x.com/BeginWallet" }],
        }),
      ).toEqual(["Prices the main offer as published"]);
  });

  it('fails a "Not public" price and a missing profile', () => {
    expect(
      failed({
        ...brain,
        summary: "Begin is a Cardano wallet.",
        offers: [
          { name: "Begin Wallet", what: "A wallet", price: "Not public" },
        ],
        channels: [{ name: "YouTube", url: "https://youtube.com/@begin" }],
      }),
    ).toEqual([
      "Prices the main offer as published",
      "Lists its social profile",
    ]);
  });
});
