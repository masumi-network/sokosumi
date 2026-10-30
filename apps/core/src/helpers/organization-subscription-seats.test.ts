import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createScheduleMock,
  previewRenewalAtQuantityMock,
  previewScheduleRenewalMock,
  releaseScheduleMock,
  retrieveScheduleMock,
  updateScheduleMock,
} = vi.hoisted(() => ({
  createScheduleMock: vi.fn(),
  previewRenewalAtQuantityMock: vi.fn(),
  previewScheduleRenewalMock: vi.fn(),
  releaseScheduleMock: vi.fn(),
  retrieveScheduleMock: vi.fn(),
  updateScheduleMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createSubscriptionScheduleFromSubscription: (...args: unknown[]) =>
      createScheduleMock(...args),
    previewSubscriptionRenewalAtQuantity: (...args: unknown[]) =>
      previewRenewalAtQuantityMock(...args),
    previewSubscriptionScheduleRenewal: (...args: unknown[]) =>
      previewScheduleRenewalMock(...args),
    releaseSubscriptionSchedule: (...args: unknown[]) =>
      releaseScheduleMock(...args),
    retrieveSubscriptionSchedule: (...args: unknown[]) =>
      retrieveScheduleMock(...args),
    updateSubscriptionSchedule: (...args: unknown[]) =>
      updateScheduleMock(...args),
  },
}));

import {
  previewRenewalAtSeats,
  releaseAppliedSeatReduction,
  releaseSeatReduction,
  resolveScheduledSeatReduction,
  scheduleSeatReduction,
} from "./organization-subscription-seats";

const PERIOD_START = 1_764_547_200;
const PERIOD_END = 1_767_225_600;
const NEXT_PERIOD_END = PERIOD_END + 2_592_000;
const SEAT_REDUCTION = { purpose: "seat_reduction" };

function phase(start: number, end: number, quantity: number, extra = {}) {
  return {
    discounts: [],
    end_date: end,
    items: [{ price: "price_starter", quantity }],
    start_date: start,
    ...extra,
  };
}

function schedule(overrides: Record<string, unknown> = {}) {
  return {
    current_phase: { end_date: PERIOD_END, start_date: PERIOD_START },
    id: "sub_sched_1",
    metadata: SEAT_REDUCTION,
    phases: [
      phase(PERIOD_START, PERIOD_END, 6),
      phase(PERIOD_END, NEXT_PERIOD_END, 2),
    ],
    status: "active",
    ...overrides,
  } as never;
}

const SUBSCRIPTION = { id: "sub_1", schedule: null };

beforeEach(() => {
  vi.clearAllMocks();
  createScheduleMock.mockResolvedValue(
    schedule({
      metadata: {},
      phases: [phase(PERIOD_START, PERIOD_END, 6)],
    }),
  );
  updateScheduleMock.mockResolvedValue(schedule());
  releaseScheduleMock.mockResolvedValue({});
});

describe("resolveScheduledSeatReduction", () => {
  it("reads the seats and the date of the next phase", () => {
    expect(resolveScheduledSeatReduction(schedule())).toEqual({
      scheduledSeats: 2,
      scheduledSeatsAt: new Date(PERIOD_END * 1000),
    });
  });

  it("finds nothing pending once the last phase is running", () => {
    expect(
      resolveScheduledSeatReduction(
        schedule({
          current_phase: { end_date: NEXT_PERIOD_END, start_date: PERIOD_END },
        }),
      ),
    ).toBeNull();
  });

  it("ignores a released schedule and a schedule it did not create", () => {
    expect(
      resolveScheduledSeatReduction(schedule({ status: "released" })),
    ).toBeNull();
    expect(
      resolveScheduledSeatReduction(schedule({ metadata: {} })),
    ).toBeNull();
  });
});

describe("scheduleSeatReduction", () => {
  it("keeps the current phase and adds the lower count, without proration", async () => {
    await expect(scheduleSeatReduction(SUBSCRIPTION, 2)).resolves.toEqual({
      scheduleId: "sub_sched_1",
      scheduledSeats: 2,
      scheduledSeatsAt: new Date(PERIOD_END * 1000),
    });

    expect(createScheduleMock).toHaveBeenCalledWith("sub_1");
    const [, params] = updateScheduleMock.mock.calls[0] ?? [];
    expect(params).toMatchObject({
      end_behavior: "release",
      metadata: { purpose: "seat_reduction", source: "@better-auth/stripe" },
      proration_behavior: "none",
      phases: [
        {
          end_date: PERIOD_END,
          items: [{ price: "price_starter", quantity: 6 }],
          proration_behavior: "none",
          start_date: PERIOD_START,
        },
        {
          items: [{ price: "price_starter", quantity: 2 }],
          proration_behavior: "none",
        },
      ],
    });
  });

  it("carries a discount onto both phases, because omitting it clears it", async () => {
    createScheduleMock.mockResolvedValue(
      schedule({
        metadata: {},
        phases: [
          phase(PERIOD_START, PERIOD_END, 6, {
            discounts: [
              { coupon: "cpn_1", discount: null, promotion_code: null },
            ],
          }),
        ],
      }),
    );

    await scheduleSeatReduction(SUBSCRIPTION, 2);

    const [, params] = updateScheduleMock.mock.calls[0] ?? [];
    expect(params.phases[0].discounts).toEqual([{ coupon: "cpn_1" }]);
    expect(params.phases[1].discounts).toEqual([{ coupon: "cpn_1" }]);
  });

  it("changes a pending reduction instead of creating a second schedule", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule());

    await scheduleSeatReduction({ id: "sub_1", schedule: "sub_sched_1" }, 3);

    expect(createScheduleMock).not.toHaveBeenCalled();
    const [scheduleId, params] = updateScheduleMock.mock.calls[0] ?? [];
    expect(scheduleId).toBe("sub_sched_1");
    expect(params.phases).toHaveLength(2);
    expect(params.phases[0].items).toEqual([
      { price: "price_starter", quantity: 6 },
    ]);
  });

  it("builds from the running phase when finished phases remain", async () => {
    retrieveScheduleMock.mockResolvedValue(
      schedule({
        current_phase: { end_date: NEXT_PERIOD_END, start_date: PERIOD_END },
      }),
    );
    updateScheduleMock.mockResolvedValue(
      schedule({
        current_phase: { end_date: NEXT_PERIOD_END, start_date: PERIOD_END },
        phases: [
          phase(PERIOD_END, NEXT_PERIOD_END, 2),
          phase(NEXT_PERIOD_END, NEXT_PERIOD_END + 2_592_000, 1),
        ],
      }),
    );

    await scheduleSeatReduction({ id: "sub_1", schedule: "sub_sched_1" }, 1);

    const [, params] = updateScheduleMock.mock.calls[0] ?? [];
    expect(params.phases[0]).toMatchObject({
      end_date: NEXT_PERIOD_END,
      items: [{ price: "price_starter", quantity: 2 }],
      start_date: PERIOD_END,
    });
  });

  it("refuses to overwrite a schedule it did not create", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule({ metadata: {} }));

    await expect(
      scheduleSeatReduction({ id: "sub_1", schedule: "sub_sched_portal" }, 2),
    ).rejects.toMatchObject({ status: 400 });

    expect(updateScheduleMock).not.toHaveBeenCalled();
    expect(releaseScheduleMock).not.toHaveBeenCalled();
  });

  it("releases a schedule it just created when the update fails", async () => {
    const failure = new Error("Stripe is unavailable");
    updateScheduleMock.mockRejectedValue(failure);

    await expect(scheduleSeatReduction(SUBSCRIPTION, 2)).rejects.toBe(failure);

    expect(releaseScheduleMock).toHaveBeenCalledWith("sub_sched_1");
  });

  it("keeps a schedule that already existed when the update fails", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule());
    updateScheduleMock.mockRejectedValue(new Error("Stripe is unavailable"));

    await expect(
      scheduleSeatReduction({ id: "sub_1", schedule: "sub_sched_1" }, 3),
    ).rejects.toThrow("Stripe is unavailable");

    expect(releaseScheduleMock).not.toHaveBeenCalled();
  });
});

describe("previewRenewalAtSeats", () => {
  it("previews the subscription when no schedule manages it", async () => {
    previewRenewalAtQuantityMock.mockResolvedValue({ total: 8925 });

    await expect(
      previewRenewalAtSeats({
        seatItemId: "si_1",
        seats: 3,
        stripeSubscription: SUBSCRIPTION,
      }),
    ).resolves.toEqual({ total: 8925 });

    expect(previewRenewalAtQuantityMock).toHaveBeenCalledWith(
      "sub_1",
      "si_1",
      3,
    );
    expect(previewScheduleRenewalMock).not.toHaveBeenCalled();
  });

  it("goes through the schedule, which would otherwise override the count", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule());
    previewScheduleRenewalMock.mockResolvedValue({ total: 8925 });

    await previewRenewalAtSeats({
      seatItemId: "si_1",
      seats: 3,
      stripeSubscription: { id: "sub_1", schedule: "sub_sched_1" },
    });

    expect(previewRenewalAtQuantityMock).not.toHaveBeenCalled();
    const [scheduleId, phases] = previewScheduleRenewalMock.mock.calls[0] ?? [];
    expect(scheduleId).toBe("sub_sched_1");
    expect(phases[0].items).toEqual([{ price: "price_starter", quantity: 6 }]);
    expect(phases[1].items).toEqual([{ price: "price_starter", quantity: 3 }]);
    expect(updateScheduleMock).not.toHaveBeenCalled();
  });

  it("keeps the price of a scheduled plan change", async () => {
    retrieveScheduleMock.mockResolvedValue(
      schedule({
        metadata: {},
        phases: [
          phase(PERIOD_START, PERIOD_END, 6),
          {
            ...phase(PERIOD_END, NEXT_PERIOD_END, 6),
            items: [{ price: "price_pro", quantity: 6 }],
          },
        ],
      }),
    );
    previewScheduleRenewalMock.mockResolvedValue({ total: 1 });

    await previewRenewalAtSeats({
      seatItemId: "si_1",
      seats: 8,
      stripeSubscription: { id: "sub_1", schedule: "sub_sched_portal" },
    });

    const [, phases] = previewScheduleRenewalMock.mock.calls[0] ?? [];
    expect(phases[1].items).toEqual([{ price: "price_pro", quantity: 8 }]);
  });
});

describe("releaseSeatReduction", () => {
  it("releases its own schedule", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule());

    await expect(
      releaseSeatReduction({ schedule: "sub_sched_1" }),
    ).resolves.toBe(true);

    expect(releaseScheduleMock).toHaveBeenCalledWith("sub_sched_1");
  });

  it("does nothing without a schedule, or with somebody else's", async () => {
    await expect(releaseSeatReduction({ schedule: null })).resolves.toBe(false);

    retrieveScheduleMock.mockResolvedValue(schedule({ metadata: {} }));
    await expect(
      releaseSeatReduction({ schedule: "sub_sched_portal" }),
    ).resolves.toBe(false);

    expect(releaseScheduleMock).not.toHaveBeenCalled();
  });
});

describe("releaseAppliedSeatReduction", () => {
  it("releases once the lower count is running", async () => {
    retrieveScheduleMock.mockResolvedValue(
      schedule({
        current_phase: { end_date: NEXT_PERIOD_END, start_date: PERIOD_END },
      }),
    );

    await releaseAppliedSeatReduction({ schedule: "sub_sched_1" });

    expect(releaseScheduleMock).toHaveBeenCalledWith("sub_sched_1");
  });

  it("leaves a reduction that has not happened yet", async () => {
    retrieveScheduleMock.mockResolvedValue(schedule());

    await releaseAppliedSeatReduction({ schedule: "sub_sched_1" });

    expect(releaseScheduleMock).not.toHaveBeenCalled();
  });

  it("does not read Stripe for a subscription without a schedule", async () => {
    await releaseAppliedSeatReduction({ schedule: null });

    expect(retrieveScheduleMock).not.toHaveBeenCalled();
  });
});
