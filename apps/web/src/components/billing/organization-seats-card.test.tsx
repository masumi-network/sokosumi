import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestQueryProvider } from "@/test/query-provider";

const refreshMock = vi.fn();
const previewMock = vi.fn();
const updateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "Apr 1, 2026",
    number: (value: number, options: { currency: string }) =>
      `${options.currency} ${value.toFixed(2)}`,
  }),
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/subscription/action", () => ({
  previewOrganizationSubscriptionSeats: (...args: unknown[]) =>
    previewMock(...args),
  updateOrganizationSubscriptionSeats: (...args: unknown[]) =>
    updateMock(...args),
}));

import { OrganizationSeatsCard } from "./organization-seats-card";

const ADD_TWO = 'seatsCard.addCta:{"count":2}';
const REMOVE_TWO = 'seatsCard.removeCta:{"count":2}';

function renderCard({
  assignedCount = 1,
  onError = vi.fn(),
  scheduledCancelDate = null,
  scheduledSeats = null,
  scheduledSeatsAt = null,
}: {
  assignedCount?: number;
  onError?: (error: { code: string }) => void;
  scheduledCancelDate?: Date | null;
  scheduledSeats?: number | null;
  scheduledSeatsAt?: Date | null;
} = {}) {
  render(
    <TestQueryProvider>
      <OrganizationSeatsCard
        assignedCount={assignedCount}
        currentSeats={3}
        onError={onError}
        organizationId="org-1"
        scheduledCancelDate={scheduledCancelDate}
        scheduledSeats={scheduledSeats}
        scheduledSeatsAt={scheduledSeatsAt}
      />
    </TestQueryProvider>,
  );
  return { onError };
}

async function setSeats(value: string) {
  const input = screen.getByRole("spinbutton");
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  previewMock.mockResolvedValue({
    ok: true,
    value: {
      amountDue: 1234,
      currency: "eur",
      effectiveAt: null,
      newMonthlyAmount: 12500,
      seats: 5,
    },
  });
  updateMock.mockResolvedValue({
    ok: true,
    value: { scheduledSeats: null, seats: 5 },
  });
});

describe("OrganizationSeatsCard", () => {
  it("offers adding seats once the count goes up", async () => {
    renderCard();

    expect(
      screen.getByRole("button", { name: "seatsCard.addIdleCta" }),
    ).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: "seatsCard.increase" }),
    );

    expect(screen.getByRole("spinbutton")).toHaveValue(4);
    expect(
      screen.getByRole("button", { name: 'seatsCard.addCta:{"count":1}' }),
    ).toBeEnabled();
  });

  it("lets the field be cleared and retyped", async () => {
    renderCard();
    const input = screen.getByRole("spinbutton");

    await userEvent.clear(input);

    expect(input).toHaveValue(null);
    expect(
      screen.getByRole("button", { name: "seatsCard.addIdleCta" }),
    ).toBeDisabled();

    await userEvent.type(input, "5");

    expect(input).toHaveValue(5);
    expect(screen.getByRole("button", { name: ADD_TWO })).toBeEnabled();
  });

  it("shows Stripe's price, then adds the seats after confirmation", async () => {
    renderCard();
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(
      'seatsCard.dialog.approximate:{"amount":"EUR 12.34"}',
    );
    expect(within(dialog).getByText("EUR 125.00")).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      seats: 5,
    });
    expect(updateMock).not.toHaveBeenCalled();

    await userEvent.click(
      within(dialog).getByRole("button", { name: ADD_TWO }),
    );

    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        seats: 5,
      });
      expect(toast.success).toHaveBeenCalledWith("seatsUpdatedSuccess");
      expect(refreshMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("does not allow confirming until the price has loaded", async () => {
    previewMock.mockReturnValue(new Promise(() => {}));
    renderCard();
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: ADD_TWO }),
    ).toBeDisabled();
  });

  it("blocks confirming when the price fails, and recovers on retry", async () => {
    previewMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    renderCard();
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("seatsCard.dialog.previewError");
    expect(
      within(dialog).getByRole("button", { name: ADD_TWO }),
    ).toBeDisabled();

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "seatsCard.dialog.previewRetry",
      }),
    );

    await within(dialog).findByText(
      'seatsCard.dialog.approximate:{"amount":"EUR 12.34"}',
    );
    expect(within(dialog).getByRole("button", { name: ADD_TWO })).toBeEnabled();
  });

  it("says a removal waits for renewal, and warns how many members lose a seat", async () => {
    previewMock.mockResolvedValue({
      ok: true,
      value: {
        amountDue: 0,
        currency: "eur",
        effectiveAt: new Date("2026-04-01T00:00:00.000Z"),
        newMonthlyAmount: 2500,
        seats: 1,
      },
    });
    updateMock.mockResolvedValue({
      ok: true,
      value: { scheduledSeats: 1, seats: 3 },
    });
    renderCard({ assignedCount: 3 });
    await setSeats("1");

    await userEvent.click(screen.getByRole("button", { name: REMOVE_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText("seatsCard.dialog.effectiveAt");
    expect(within(dialog).getByText("Apr 1, 2026")).toBeInTheDocument();
    expect(
      within(dialog).getByText("seatsCard.dialog.removeDescription"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('seatsCard.dialog.seatsLost:{"count":2}'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("seatsCard.dialog.dueNow")).toBeNull();

    await userEvent.click(
      within(dialog).getByRole("button", { name: REMOVE_TWO }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("seatsScheduledSuccess"),
    );
  });

  it("starts from a pending reduction and offers to keep the seats", async () => {
    updateMock.mockResolvedValue({
      ok: true,
      value: { scheduledSeats: null, seats: 3 },
    });
    renderCard({
      scheduledSeats: 1,
      scheduledSeatsAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    expect(screen.getByRole("spinbutton")).toHaveValue(1);
    expect(
      screen.getByText(
        'seatsCard.scheduledNote:{"date":"Apr 1, 2026","seats":1}',
        { exact: false },
      ),
    ).toBeInTheDocument();
    // The stepper already shows the pending count: nothing to confirm yet.
    expect(screen.getByRole("button", { name: REMOVE_TWO })).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: 'seatsCard.keepCta:{"count":3}' }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("seatsCard.dialog.keepDescription"),
    ).toBeInTheDocument();
    await within(dialog).findByText("seatsCard.dialog.newMonthly");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: 'seatsCard.keepCta:{"count":3}',
      }),
    );

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        seats: 3,
      }),
    );
  });

  it("blocks removing seats while the plan is set to end", async () => {
    renderCard({ scheduledCancelDate: new Date("2026-04-01T00:00:00.000Z") });
    await setSeats("1");

    expect(screen.getByRole("button", { name: REMOVE_TWO })).toBeDisabled();
    expect(
      screen.getByText('seatsCard.removeBlocked:{"date":"Apr 1, 2026"}'),
    ).toBeInTheDocument();
  });

  it("does not warn about lost seats when unused seats cover the removal", async () => {
    renderCard({ assignedCount: 1 });
    await setSeats("1");

    await userEvent.click(screen.getByRole("button", { name: REMOVE_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).queryByText(/seatsCard\.dialog\.seatsLost/),
    ).not.toBeInTheDocument();
  });

  it("says the seats end with a scheduled cancellation", async () => {
    renderCard({ scheduledCancelDate: new Date("2026-04-01T00:00:00.000Z") });
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        'seatsCard.dialog.cancellationNote:{"date":"Apr 1, 2026"}',
      ),
    ).toBeInTheDocument();
  });

  it("reports a failed update and closes the dialog", async () => {
    const error = { code: "INTERNAL_SERVER_ERROR" };
    updateMock.mockResolvedValue({ ok: false, error });
    const { onError } = renderCard();
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));
    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(
      'seatsCard.dialog.approximate:{"amount":"EUR 12.34"}',
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: ADD_TWO }),
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(error);
    });
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });
});
