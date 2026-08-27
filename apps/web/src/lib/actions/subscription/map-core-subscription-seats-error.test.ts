import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors";
import { CoreApiRequestError } from "@/lib/clients/core.client";

import {
  mapCoreSubscriptionSeatsWriteError,
  toSubscriptionSeatsActionError,
} from "./map-core-subscription-seats-error";

describe("mapCoreSubscriptionSeatsWriteError", () => {
  it("returns undefined for non-core errors", () => {
    expect(
      mapCoreSubscriptionSeatsWriteError(new Error("boom")),
    ).toBeUndefined();
  });

  it.each([
    {
      label: "organization_role_forbidden",
      error: new CoreApiRequestError("You must be OWNER, ADMIN", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
        status: 403,
      }),
      expectedMessage:
        "Only organization owners and admins can manage subscriptions",
    },
    {
      label: "organization_not_found",
      error: new CoreApiRequestError("Some reworded organization error", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
      }),
      expectedMessage:
        "Only organization owners and admins can manage subscriptions",
    },
    {
      label: "organization_membership_required",
      error: new CoreApiRequestError(
        "You are not a member of this organization",
        {
          kind: CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED,
          status: 403,
        },
      ),
      expectedMessage: "You are not a member of this organization",
    },
    {
      label: "subscription_seats_below_assigned",
      error: new CoreApiRequestError(
        "Purchased seats (3) must be at least 4 to cover all assigned members",
        {
          kind: CORE_API_ERROR_KINDS.SUBSCRIPTION_SEATS_BELOW_ASSIGNED,
          status: 400,
        },
      ),
      expectedMessage:
        "Purchased seats (3) must be at least 4 to cover all assigned members",
    },
    {
      label: "legacy 404 without kind",
      error: new CoreApiRequestError("Organization not found", {
        status: 404,
      }),
      expectedMessage:
        "Only organization owners and admins can manage subscriptions",
    },
  ])("$label", ({ error, expectedMessage }) => {
    const mapped = mapCoreSubscriptionSeatsWriteError(error);

    expect(mapped?.message).toBe(expectedMessage);
  });

  it("returns undefined for unmapped core statuses", () => {
    expect(
      mapCoreSubscriptionSeatsWriteError(
        new CoreApiRequestError("Unauthorized", { status: 401 }),
      ),
    ).toBeUndefined();
  });
});

describe("toSubscriptionSeatsActionError", () => {
  it("maps mapped API errors to action errors", () => {
    expect(
      toSubscriptionSeatsActionError(
        new CoreApiRequestError("You must be OWNER, ADMIN", {
          kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
          status: 403,
        }),
      ),
    ).toEqual({
      code: CommonErrorCode.UNAUTHORIZED,
      message: "Only organization owners and admins can manage subscriptions",
    });
  });

  it("falls back to toCoreApiActionError for unmapped core errors", () => {
    expect(
      toSubscriptionSeatsActionError(
        new CoreApiRequestError("Unexpected core failure", { status: 500 }),
      ),
    ).toEqual({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "Unexpected core failure",
    });
  });
});
