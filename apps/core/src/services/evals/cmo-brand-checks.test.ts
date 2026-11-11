import { describe, expect, it } from "vitest";

import { brandBrainChecks } from "./cmo-brand-checks";
import brains from "./fixtures/cmo-brand-brains.json";

const brain = (brains as Record<string, Record<string, unknown>>)["cal.com"];
const begin = {
  name: "Begin",
  url: "https://begin.is/",
  goal: "More users",
  main: "wallet",
  price: "free",
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
