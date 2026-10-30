import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
}: {
  assignedCount?: number;
  onError?: (error: { code: string }) => void;
  scheduledCancelDate?: Date | null;
} = {}) {
  render(
    <TestQueryProvider>
      <OrganizationSeatsCard
        assignedCount={assignedCount}
        currentSeats={3}
        onError={onError}
        organizationId="org-1"
        scheduledCancelDate={scheduledCancelDate}
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
      creditAmount: 0,
      currency: "eur",
      newMonthlyAmount: 12500,
      seats: 5,
    },
  });
  updateMock.mockResolvedValue({ ok: true, value: { seats: 5 } });
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

  it("warns how many members lose a seat and where the money goes", async () => {
    previewMock.mockResolvedValue({
      ok: true,
      value: {
        amountDue: 0,
        creditAmount: 800,
        currency: "eur",
        newMonthlyAmount: 2500,
        seats: 1,
      },
    });
    renderCard({ assignedCount: 3 });
    await setSeats("1");

    await userEvent.click(screen.getByRole("button", { name: REMOVE_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    await within(dialog).findByText(
      'seatsCard.dialog.approximate:{"amount":"EUR 8.00"}',
    );
    expect(
      within(dialog).getByText('seatsCard.dialog.seatsLost:{"count":2}'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("seatsCard.dialog.creditNote"),
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
    await within(dialog).findByText(
      'seatsCard.dialog.approximate:{"amount":"EUR 12.34"}',
    );
    expect(
      within(dialog).getByText(
        'seatsCard.dialog.cancellationNote:{"date":"Apr 1, 2026"}',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("seatsCard.dialog.newMonthly"),
    ).not.toBeInTheDocument();
  });

  it("states the assigned and unused counts", () => {
    renderCard({ assignedCount: 1 });

    expect(
      screen.getByText(
        'seatsCard.summary:{"assigned":1,"purchased":3,"unused":2}',
      ),
    ).toBeInTheDocument();
  });

  it("does not report negative unused seats when over capacity", () => {
    renderCard({ assignedCount: 4 });

    expect(
      screen.getByText(
        'seatsCard.summary:{"assigned":4,"purchased":3,"unused":0}',
      ),
    ).toBeInTheDocument();
  });

  it("returns focus to the button when the dialog closes", async () => {
    renderCard();
    await setSeats("5");
    const button = screen.getByRole("button", { name: ADD_TWO });

    await userEvent.click(button);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "seatsCard.dialog.cancel" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });
  });

  it("announces the loading, price and failure states through one live region", async () => {
    let resolvePreview: (value: unknown) => void = () => {};
    previewMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    renderCard();
    await setSeats("5");

    await userEvent.click(screen.getByRole("button", { name: ADD_TWO }));

    const dialog = await screen.findByRole("alertdialog");
    const status = within(dialog).getByRole("status");
    expect(status).toHaveTextContent("seatsCard.dialog.loading");

    resolvePreview({ ok: false, error: { code: "INTERNAL_SERVER_ERROR" } });

    await waitFor(() => {
      expect(status).toHaveTextContent("seatsCard.dialog.previewError");
    });
    expect(within(dialog).getByRole("status")).toBe(status);

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "seatsCard.dialog.previewRetry",
      }),
    );

    await waitFor(() => {
      expect(status).toHaveTextContent("EUR 125.00");
    });
    expect(within(dialog).getByRole("status")).toBe(status);
  });

  it("returns to idle once the new seat count arrives", () => {
    const { rerender } = render(
      <TestQueryProvider>
        <OrganizationSeatsCard
          assignedCount={1}
          currentSeats={3}
          onError={vi.fn()}
          organizationId="org-1"
          scheduledCancelDate={null}
        />
      </TestQueryProvider>,
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "5" },
    });
    expect(screen.getByRole("button", { name: ADD_TWO })).toBeEnabled();

    rerender(
      <TestQueryProvider>
        <OrganizationSeatsCard
          assignedCount={1}
          currentSeats={5}
          onError={vi.fn()}
          organizationId="org-1"
          scheduledCancelDate={null}
        />
      </TestQueryProvider>,
    );

    expect(
      screen.getByRole("button", { name: "seatsCard.addIdleCta" }),
    ).toBeDisabled();
    expect(screen.getByRole("spinbutton")).toHaveValue(5);
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
