import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/../messages/en.json";
import { ChangeCreditsPerMonthDialog } from "./change-credits-per-month-dialog";

const { updateMock, refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock("sonner", () => ({
  toast: { success: successMock, error: errorMock },
}));
vi.mock("@/lib/actions/enterprise-contract/action", () => ({
  updateEnterpriseContractAction: updateMock,
}));

function dialog(creditsPerMonth = 60_000) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChangeCreditsPerMonthDialog
        contractId="contract-1"
        creditsPerMonth={creditsPerMonth}
      />
    </NextIntlClientProvider>
  );
}

describe("ChangeCreditsPerMonthDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateMock.mockResolvedValue({
      ok: true,
      value: { creditsPerMonth: 100_000 },
    });
  });

  it("discards canceled edits and opens with the refreshed contract amount", async () => {
    const user = userEvent.setup();
    const { rerender } = render(dialog());
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "90000" },
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(dialog(100_000));
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );

    expect(screen.getByRole("spinbutton")).toHaveValue(100_000);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("submits only monthly credits once, then closes and refreshes", async () => {
    const user = userEvent.setup();
    render(dialog());
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "100000" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMock).toHaveBeenCalledExactlyOnceWith({
      id: "contract-1",
      body: { creditsPerMonth: 100_000 },
    });
    expect(successMock).toHaveBeenCalledWith("Credits per month updated");
    expect(refreshMock).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("retains input and shows the server error without refreshing", async () => {
    updateMock.mockResolvedValue({
      ok: false,
      error: { message: "Contract is canceled" },
    });
    const user = userEvent.setup();
    render(dialog());
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "100000" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(errorMock).toHaveBeenCalledWith("Contract is canceled");
    expect(screen.getByRole("spinbutton")).toHaveValue(100_000);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps a pending submit open and ignores repeated clicks", async () => {
    let resolve: (result: { ok: true; value: object }) => void = () => {};
    updateMock.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    render(dialog());
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );
    await user.dblClick(screen.getByRole("button", { name: "Save" }));
    await user.keyboard("{Escape}");

    expect(updateMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => resolve({ ok: true, value: {} }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("opens and closes by keyboard and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(dialog());
    const trigger = screen.getByRole("button", {
      name: "Change credits per month",
    });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("dialog", { name: "Change credits per month" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Credits / month")).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("shows a translated error for a rejected action and permits retry", async () => {
    updateMock.mockRejectedValueOnce(new Error("Network unavailable"));
    const user = userEvent.setup();
    render(dialog());
    await user.click(
      screen.getByRole("button", { name: "Change credits per month" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(errorMock).toHaveBeenCalledWith(
      "Failed to update credits per month",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });
});
