import { describe, expect, it } from "vitest";

import { getTaskEventChargePresentation } from "../task-event-charge-presentation";

describe("getTaskEventChargePresentation", () => {
  it.each([
    {
      name: "credit-only settled",
      event: {
        comment: null,
        status: null,
        credits: 5,
        transactionId: "txn_1",
      },
      expected: {
        hasComment: false,
        hasCharge: true,
        isAttemptedCharge: false,
        actionKind: "charged",
        shouldShowSecondaryChargeLine: false,
      },
    },
    {
      name: "credit-only attempted",
      event: {
        comment: null,
        status: null,
        credits: 4,
        transactionId: null,
      },
      expected: {
        hasComment: false,
        hasCharge: true,
        isAttemptedCharge: true,
        actionKind: "charged",
        shouldShowSecondaryChargeLine: false,
      },
    },
    {
      name: "pause status with attempted charge",
      event: {
        comment: null,
        status: "OUT_OF_CREDITS",
        credits: 3,
        transactionId: null,
      },
      expected: {
        hasComment: false,
        hasCharge: true,
        isAttemptedCharge: true,
        actionKind: "updatedStatus",
        shouldShowSecondaryChargeLine: true,
      },
    },
    {
      name: "comment with settled charge",
      event: {
        comment: "Shared update",
        status: null,
        credits: 2,
        transactionId: "txn_2",
      },
      expected: {
        hasComment: true,
        hasCharge: true,
        isAttemptedCharge: false,
        actionKind: "commented",
        shouldShowSecondaryChargeLine: true,
      },
    },
    {
      name: "status only",
      event: {
        comment: null,
        status: "RUNNING",
        credits: null,
        transactionId: null,
      },
      expected: {
        hasComment: false,
        hasCharge: false,
        isAttemptedCharge: false,
        actionKind: "updatedStatus",
        shouldShowSecondaryChargeLine: false,
      },
    },
    {
      name: "blank comment with settled charge treated as credit-only",
      event: {
        comment: "   ",
        status: null,
        credits: 4,
        transactionId: "txn_blank",
      },
      expected: {
        hasComment: false,
        hasCharge: true,
        isAttemptedCharge: false,
        actionKind: "charged",
        shouldShowSecondaryChargeLine: false,
      },
    },
    {
      name: "no comment status or charge",
      event: {
        comment: null,
        status: null,
        credits: null,
        transactionId: null,
      },
      expected: {
        hasComment: false,
        hasCharge: false,
        isAttemptedCharge: false,
        actionKind: "updatedStatus",
        shouldShowSecondaryChargeLine: false,
      },
    },
  ] as const)("$name", ({ event, expected }) => {
    expect(getTaskEventChargePresentation(event)).toEqual(expected);
  });
});
