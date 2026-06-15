import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.client";

import { mapCoreSubscriptionSeatsWriteError } from "../map-core-subscription-seats-error";

describe("mapCoreSubscriptionSeatsWriteError", () => {
  it("returns undefined for non-core errors", () => {
    expect(
      mapCoreSubscriptionSeatsWriteError(new Error("boom")),
    ).toBeUndefined();
  });

  it("maps organization_role_forbidden to owner/admin copy", () => {
    const mapped = mapCoreSubscriptionSeatsWriteError(
      new CoreApiRequestError("You must be OWNER, ADMIN", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
        status: 403,
      }),
    );

    expect(mapped?.status).toBe("FORBIDDEN");
    expect(mapped?.message).toBe(
      "Only organization owners and admins can manage subscriptions",
    );
  });

  it("keeps organization_membership_required message", () => {
    const mapped = mapCoreSubscriptionSeatsWriteError(
      new CoreApiRequestError("You are not a member of this organization", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
        status: 403,
      }),
    );

    expect(mapped?.status).toBe("FORBIDDEN");
    expect(mapped?.message).toBe("You are not a member of this organization");
  });

  it("returns undefined for unmapped core statuses", () => {
    expect(
      mapCoreSubscriptionSeatsWriteError(
        new CoreApiRequestError("Unauthorized", { status: 401 }),
      ),
    ).toBeUndefined();
  });
});
