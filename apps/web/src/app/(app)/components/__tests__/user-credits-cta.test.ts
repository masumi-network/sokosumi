import { resolveUserCreditsCta } from "@/app/components/user-credits-cta";

describe("resolveUserCreditsCta", () => {
  it("returns upgradePlan when upgrade CTA is eligible", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "starter",
        hasLowCredits: false,
      }),
    ).toBe("upgradePlan");
  });

  it("keeps addCredits as the highest-priority CTA", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "starter",
        hasLowCredits: true,
      }),
    ).toBe("addCredits");
  });

  it("returns none for unavailable plans when add-credits is not eligible", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: null,
        hasLowCredits: false,
      }),
    ).toBe("none");
  });
});
