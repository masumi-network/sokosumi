import { resolveUserCreditsCta } from "@/app/components/user-credits-cta";

describe("resolveUserCreditsCta", () => {
  it("returns upgradePlan when upgrade CTA is eligible", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "starter",
        hasLowCredits: false,
        suppressLowCreditsCta: false,
      }),
    ).toBe("upgradePlan");
  });

  it("keeps addCredits as the highest-priority CTA", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "starter",
        hasLowCredits: true,
        suppressLowCreditsCta: false,
      }),
    ).toBe("addCredits");
  });

  it("returns none for unavailable plans when add-credits is not eligible", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: null,
        hasLowCredits: false,
        suppressLowCreditsCta: false,
      }),
    ).toBe("none");
  });

  it("suppresses the duplicate CTA when the top low-credits banner is active", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "starter",
        hasLowCredits: true,
        suppressLowCreditsCta: true,
      }),
    ).toBe("none");
  });

  it("keeps the free-plan upgrade CTA when credits are not low", () => {
    expect(
      resolveUserCreditsCta({
        currentPlan: "free",
        hasLowCredits: false,
        suppressLowCreditsCta: true,
      }),
    ).toBe("upgradePlan");
  });
});
