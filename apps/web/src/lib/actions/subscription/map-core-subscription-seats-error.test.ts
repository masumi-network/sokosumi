import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { CoreApiRequestError } from "@/lib/clients/core.client";

import { toSubscriptionSeatsActionError } from "./map-core-subscription-seats-error";

describe("toSubscriptionSeatsActionError", () => {
  it.each([
    {
      label: "organization_role_forbidden",
      error: new CoreApiRequestError("You must be OWNER, ADMIN", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_ROLE_FORBIDDEN,
        status: 403,
      }),
      expected: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Only organization owners and admins can manage subscriptions",
      },
    },
    {
      label: "organization_not_found",
      error: new CoreApiRequestError("Some reworded organization error", {
        kind: CORE_API_ERROR_KINDS.ORGANIZATION_NOT_FOUND,
      }),
      expected: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Only organization owners and admins can manage subscriptions",
      },
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
      expected: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "You are not a member of this organization",
      },
    },
    {
      label: "concurrency_conflict",
      error: new CoreApiRequestError(
        "Seat update lost a concurrent update. Try again.",
        {
          kind: "concurrency_conflict",
          status: 409,
        },
      ),
      expected: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Another seat change was in progress. Try again.",
      },
    },
    {
      label: "a 409 without a kind",
      error: new CoreApiRequestError(
        "Seat update lost a concurrent update. Try again.",
        { status: 409 },
      ),
      expected: {
        code: CommonErrorCode.BAD_INPUT,
        message: "Another seat change was in progress. Try again.",
      },
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
      expected: {
        code: CommonErrorCode.BAD_INPUT,
        message:
          "Purchased seats (3) must be at least 4 to cover all assigned members",
      },
    },
    {
      label: "legacy 404 without kind",
      error: new CoreApiRequestError("Organization not found", {
        status: 404,
      }),
      expected: {
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Only organization owners and admins can manage subscriptions",
      },
    },
  ])("$label", ({ error, expected }) => {
    expect(toSubscriptionSeatsActionError(error)).toEqual(expected);
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

  it("maps non-core errors to an internal server error", () => {
    expect(toSubscriptionSeatsActionError(new Error("boom"))).toEqual({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      message: "boom",
    });
  });
});
