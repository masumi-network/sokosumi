import type { AvailableAdAccount } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import messages from "../../../../../messages/en.json";
import { AdAccountPickerDialog } from "./ad-account-picker-dialog";

const ACCOUNTS: AvailableAdAccount[] = [
  {
    externalAccountId: "123-456-7890",
    name: "Launch plan",
    currency: "EUR",
    timeZone: null,
  },
  {
    externalAccountId: "098-765-4321",
    name: "Brand",
    currency: "USD",
    timeZone: null,
  },
];

function renderPicker(
  props: Partial<React.ComponentProps<typeof AdAccountPickerDialog>> = {},
) {
  const onAttach = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={{ App: { Ads: messages.App.Ads } }}
    >
      <AdAccountPickerDialog
        accounts={ACCOUNTS}
        isAttaching={false}
        onAttach={onAttach}
        onCancel={onCancel}
        provider="google_ads"
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onAttach, onCancel };
}

describe("AdAccountPickerDialog", () => {
  it("lists each account with its id and currency, none chosen yet", () => {
    renderPicker();

    expect(
      screen.getByRole("dialog", { name: "Choose ad accounts" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Launch plan.*123-456-7890.*EUR/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Brand.*098-765-4321.*USD/ }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Connect selected" }),
    ).toBeDisabled();
  });

  it("attaches the accounts that were ticked", async () => {
    const user = userEvent.setup();
    const { onAttach } = renderPicker();

    await user.click(screen.getByRole("checkbox", { name: /Launch plan/ }));
    await user.click(screen.getByRole("checkbox", { name: /Brand/ }));
    await user.click(screen.getByRole("checkbox", { name: /Launch plan/ }));
    await user.click(screen.getByRole("button", { name: "Connect selected" }));

    expect(onAttach).toHaveBeenCalledWith(["098-765-4321"]);
  });

  it("preselects the only account a login reaches", async () => {
    const user = userEvent.setup();
    const { onAttach } = renderPicker({ accounts: [ACCOUNTS[0]] });

    expect(screen.getByRole("checkbox", { name: /Launch plan/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Connect selected" }));

    expect(onAttach).toHaveBeenCalledWith(["123-456-7890"]);
  });

  it("cancels without attaching", async () => {
    const user = userEvent.setup();
    const { onAttach, onCancel } = renderPicker();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalled();
    expect(onAttach).not.toHaveBeenCalled();
  });

  it("locks the choice while attaching", () => {
    renderPicker({ accounts: [ACCOUNTS[0]], isAttaching: true });

    expect(
      screen.getByRole("checkbox", { name: /Launch plan/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
