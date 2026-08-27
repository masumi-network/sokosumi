import { describe, expect, it } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { parseEnterpriseContractActivationBlockedError } from "./enterprise-contract-admin.service";

describe("parseEnterpriseContractActivationBlockedError", () => {
  it("returns blocker details for enterprise activation conflicts", () => {
    const error = new CoreApiRequestError(
      "Enterprise contract activation blocked by an active organization subscription",
      {
        status: 409,
        details: {
          kind: "enterprise_activation_blocked",
          message:
            "Enterprise contract activation blocked by an active organization subscription",
          blocker: {
            subscriptionId: "sub_local_1",
            stripeSubscriptionId: "sub_stripe_1",
            plan: "starter",
            scope: "organization",
          },
        },
      },
    );

    expect(parseEnterpriseContractActivationBlockedError(error)).toEqual({
      kind: "enterprise_activation_blocked",
      message:
        "Enterprise contract activation blocked by an active organization subscription",
      blocker: {
        subscriptionId: "sub_local_1",
        stripeSubscriptionId: "sub_stripe_1",
        plan: "starter",
        scope: "organization",
      },
    });
  });

  it("returns null for unrelated errors", () => {
    expect(
      parseEnterpriseContractActivationBlockedError(
        new CoreApiRequestError("Conflict", { status: 409 }),
      ),
    ).toBeNull();
    expect(
      parseEnterpriseContractActivationBlockedError(new Error("nope")),
    ).toBeNull();
  });
});
