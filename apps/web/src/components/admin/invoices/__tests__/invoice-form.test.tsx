import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceForm } from "@/components/admin/invoices/invoice-form";
import type { StripeCustomerBillingDetails } from "@/lib/clients/generated/core";
import type { CreditPriceOption } from "@/lib/services/invoice-admin.service";

const getBillingMock = vi.fn();
const createInvoiceMock = vi.fn();
const mockRouterPush = vi.fn();

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const prices: CreditPriceOption[] = [
  {
    id: "price_1",
    amountPerCredit: 100,
    currency: "usd",
    nickname: null,
  },
];

const completeBillingDetails: StripeCustomerBillingDetails = {
  stripeCustomerId: "cus_complete",
  email: "billing@example.com",
  address: {
    line1: "123 Main St",
    line2: null,
    city: "Berlin",
    state: null,
    postalCode: "10115",
    country: "DE",
  },
  taxIds: [],
};

const incompleteBillingDetails: StripeCustomerBillingDetails = {
  stripeCustomerId: "cus_incomplete",
  email: null,
  address: null,
  taxIds: [],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, unknown>) => {
      if (
        namespace === "App.Admin.Invoices" &&
        key === "Form.BillingDetails.title"
      ) {
        return "Billing information";
      }
      if (
        namespace === "App.Admin.Invoices" &&
        key === "Form.BillingDetails.description"
      ) {
        return "Recipient billing description";
      }
      if (
        namespace === "App.Admin.Invoices.Form.BillingDetails" &&
        key === "addressLabel"
      ) {
        return "Billing address";
      }
      if (
        namespace === "App.Admin.Invoices.Form.BillingDetails" &&
        key === "empty"
      ) {
        return "No billing address";
      }
      if (
        namespace === "App.Admin.Invoices.Form.BillingDetails" &&
        key === "invoiceEmailLabel"
      ) {
        return "Invoice email";
      }
      if (
        namespace === "App.Admin.Invoices.Form.BillingDetails" &&
        key === "invoiceEmailEmpty"
      ) {
        return "No invoice email";
      }
      if (
        namespace === "App.Admin.Invoices.Form.BillingDetails" &&
        key === "taxIdLabel"
      ) {
        return "VAT / tax ID";
      }
      if (key === "Form.billingIncompleteOrganization") {
        return "Organization billing incomplete";
      }
      if (key === "Form.billingLoadErrorTitle") {
        return "Billing load failed";
      }
      if (key === "Form.billingRefresh") {
        return "Refresh";
      }
      if (key === "Form.submit") {
        return "Create invoice";
      }
      if (key === "Form.submitting") {
        return "Creating…";
      }
      if (values && "status" in values) {
        return `${key}:${values.status}`;
      }
      return `${namespace}.${key}`;
    },
  useFormatter: () => ({
    number: (value: number) => String(value),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/actions/invoice-admin/action", () => ({
  getAdminRecipientBillingDetailsAction: (...args: unknown[]) =>
    getBillingMock(...args),
  createAdminInvoiceAction: (...args: unknown[]) => createInvoiceMock(...args),
}));

vi.mock("@/lib/actions/admin-search/client", () => ({
  searchOrganizationsClient: vi.fn(),
  searchUsersClient: vi.fn(),
}));

vi.mock("@/components/admin/async-search-combobox", () => ({
  buildComboboxLabels: () => ({
    placeholder: "placeholder",
    searchPlaceholder: "search",
    loading: "loading",
    empty: "empty",
    error: "error",
    idle: "idle",
    clear: "clear",
  }),
  AsyncSearchCombobox: ({
    onChange,
  }: {
    onChange: (
      value: { id: string; name: string; slug: string } | null,
    ) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="select-org-1"
        onClick={() => onChange({ id: "org_1", name: "Acme", slug: "acme" })}
      >
        Select Acme
      </button>
      <button
        type="button"
        data-testid="select-org-2"
        onClick={() => onChange({ id: "org_2", name: "Beta", slug: "beta" })}
      >
        Select Beta
      </button>
    </div>
  ),
}));

describe("InvoiceForm billing preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBillingMock.mockResolvedValue({
      ok: true,
      data: completeBillingDetails,
    });
  });

  it("shows billing description and preview after selecting a recipient", async () => {
    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));

    expect(
      await screen.findByText("Recipient billing description"),
    ).toBeVisible();
    expect(await screen.findByText(/123 Main St/)).toBeVisible();
    expect(getBillingMock).toHaveBeenCalledWith({
      targetType: "organization",
      targetId: "org_1",
    });
  });

  it("disables submit when billing address has no country", async () => {
    getBillingMock.mockResolvedValue({
      ok: true,
      data: incompleteBillingDetails,
    });
    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));

    expect(
      await screen.findByText("Organization billing incomplete"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create invoice" }),
    ).toBeDisabled();
  });

  it("enables submit when billing is complete and credits are entered", async () => {
    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));
    await screen.findByText(/123 Main St/);
    await user.type(screen.getByRole("spinbutton", { name: /credits/i }), "10");

    expect(
      screen.getByRole("button", { name: "Create invoice" }),
    ).toBeEnabled();
  });

  it("shows a billing load error when the fetch action fails", async () => {
    getBillingMock.mockResolvedValue({
      ok: false,
      error: { message: "Stripe unavailable" },
    });
    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));

    expect(await screen.findByText("Stripe unavailable")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create invoice" }),
    ).toBeDisabled();
  });

  it("ignores stale billing responses when the recipient changes quickly", async () => {
    const firstLoad = createDeferred<{
      ok: true;
      data: StripeCustomerBillingDetails;
    }>();
    const secondLoad = createDeferred<{
      ok: true;
      data: StripeCustomerBillingDetails;
    }>();

    getBillingMock
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));
    await user.click(screen.getByTestId("select-org-2"));

    secondLoad.resolve({
      ok: true,
      data: {
        ...completeBillingDetails,
        address: {
          line1: "Beta Street 2",
          line2: null,
          city: "Hamburg",
          state: null,
          postalCode: "20095",
          country: "DE",
        },
      },
    });

    expect(await screen.findByText(/Beta Street 2/)).toBeVisible();

    firstLoad.resolve({
      ok: true,
      data: {
        ...completeBillingDetails,
        address: {
          line1: "Stale Acme Street 1",
          line2: null,
          city: "Berlin",
          state: null,
          postalCode: "10115",
          country: "DE",
        },
      },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Stale Acme Street 1/)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Beta Street 2/)).toBeVisible();
  });

  it("reloads billing when refresh is clicked", async () => {
    getBillingMock
      .mockResolvedValueOnce({
        ok: true,
        data: incompleteBillingDetails,
      })
      .mockResolvedValueOnce({
        ok: true,
        data: completeBillingDetails,
      });

    const user = userEvent.setup();
    render(<InvoiceForm prices={prices} />);

    await user.click(screen.getByTestId("select-org-1"));
    expect(
      await screen.findByText("Organization billing incomplete"),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText(/123 Main St/)).toBeVisible();
    expect(getBillingMock).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText("Organization billing incomplete"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create invoice" }),
    ).toBeEnabled();
  });
});
