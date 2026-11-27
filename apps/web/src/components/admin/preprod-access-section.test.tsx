import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { startTransition } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  setAdminPreprodAccessActionMock,
  refreshPageMock,
  routerRefreshMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  setAdminPreprodAccessActionMock: vi.fn(),
  refreshPageMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/actions/admin-preprod-access/action", () => ({
  setAdminPreprodAccessAction: setAdminPreprodAccessActionMock,
}));

vi.mock("@/lib/actions/refresh-page-action", () => ({
  refreshPage: refreshPageMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: toastSuccessMock },
}));

import { createFormats } from "@/i18n/time-format";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import messages from "@/messages/en.json";

import { PreprodAccessSection } from "./preprod-access-section";

const OFF_WITH_HISTORY: AdminPreprodAccess = {
  enabled: false,
  changes: [
    {
      id: "change_2",
      createdAt: new Date("2026-11-26T09:00:00.000Z"),
      enabled: false,
      reason: "SOK-2 trial ended",
      operator: { id: "admin_gone", name: null },
    },
    {
      id: "change_1",
      createdAt: new Date("2026-11-20T09:00:00.000Z"),
      enabled: true,
      reason: "SOK-1 trial",
      operator: { id: "admin_1", name: "Ada Admin" },
    },
  ],
};

const OFF_NO_HISTORY: AdminPreprodAccess = { enabled: false, changes: [] };

const ON_AFTER_SWITCH: AdminPreprodAccess = {
  enabled: true,
  changes: [
    {
      id: "change_3",
      createdAt: new Date("2026-11-27T10:00:00.000Z"),
      enabled: true,
      reason: "SOK-3",
      operator: { id: "admin_1", name: "Ada Admin" },
    },
    ...OFF_WITH_HISTORY.changes,
  ],
};

function section(access: AdminPreprodAccess | null) {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      formats={createFormats()}
      timeZone="UTC"
    >
      <PreprodAccessSection
        target={{ type: "user", id: "user_1" }}
        targetName="Grace Hopper"
        access={access}
      />
    </NextIntlClientProvider>
  );
}

// An open dialog hides the page behind it from the accessibility tree.
function historyItems() {
  return within(screen.getByRole("list", { hidden: true })).getAllByRole(
    "listitem",
    { hidden: true },
  );
}

function theSwitch() {
  return screen.getByRole("switch", { name: "Preprod access", hidden: true });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(theSwitch());
  return await screen.findByRole("dialog");
}

async function submitReason(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  reason: string,
) {
  await user.type(within(dialog).getByLabelText("Reason"), reason);
  await user.click(within(dialog).getByRole("button", { name: "Switch on" }));
}

describe("PreprodAccessSection", () => {
  beforeEach(() => {
    setAdminPreprodAccessActionMock.mockReset();
    refreshPageMock.mockReset().mockResolvedValue(true);
    routerRefreshMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("shows the flag and the history newest first, with its dates and a gone operator as unknown", () => {
    render(section(OFF_WITH_HISTORY));

    expect(theSwitch()).not.toBeChecked();
    expect(screen.getByText("Off")).toBeInTheDocument();
    const items = historyItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Switched off by an unknown admin");
    expect(items[0]).toHaveTextContent("Nov 26, 2026, 9:00 AM");
    expect(items[0]).toHaveTextContent("SOK-2 trial ended");
    expect(items[1]).toHaveTextContent("Switched on by Ada Admin");
    expect(items[1]).toHaveTextContent("Nov 20, 2026, 9:00 AM");
    expect(items[1]).toHaveTextContent("SOK-1 trial");
  });

  it("says so in one line when there is no history", () => {
    render(section(OFF_NO_HISTORY));

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("shows what the page's newest read says", () => {
    const { rerender } = render(section(OFF_WITH_HISTORY));

    rerender(section(ON_AFTER_SWITCH));

    expect(theSwitch()).toBeChecked();
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(historyItems()).toHaveLength(3);
    expect(historyItems()[0]).toHaveTextContent("SOK-3");
  });

  it("keeps a failed read inside the section, with a way to read again", async () => {
    const user = userEvent.setup();
    render(section(null));

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preprod access could not be loaded.",
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(refreshPageMock).toHaveBeenCalledTimes(1);
  });

  it("opens a dialog naming the target and the change, with only the translated Cancel to close it", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));

    const dialog = await openDialog(user);

    expect(
      within(dialog).getByText(/The user Grace Hopper gets Preprod access\./),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Reason")).toBeRequired();
    expect(within(dialog).getByLabelText("Reason")).toHaveAccessibleDescription(
      "Ticket id, no personal details.",
    );
    expect(
      within(dialog).queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(theSwitch()).not.toBeChecked();
  });

  it("returns focus to the switch when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(theSwitch()).toHaveFocus();
  });

  it("sends nothing without a reason and moves focus to the field, which names the error", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await submitReason(user, dialog, "   ");

    const field = within(dialog).getByLabelText("Reason");
    expect(setAdminPreprodAccessActionMock).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "Ticket id, no personal details. Enter a reason.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Switch on" }),
    ).toBeEnabled();
  });

  it("links the error to the field before focus lands there", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);
    const field = within(dialog).getByLabelText("Reason");
    let descriptionAtFocus = "";
    field.addEventListener("focus", () => {
      descriptionAtFocus = (field.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    });

    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));

    expect(field).toHaveFocus();
    expect(descriptionAtFocus).toContain("Enter a reason.");
  });

  it("announces the error when the reason is submitted from inside the field", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);
    const field = within(dialog).getByLabelText("Reason");
    expect(within(dialog).getByRole("status")).toHaveTextContent("");

    await user.type(field, "  {Enter}");

    expect(setAdminPreprodAccessActionMock).not.toHaveBeenCalled();
    expect(field).toHaveFocus();
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Enter a reason.",
    );
  });

  it("clears the reason error once a reason is typed", async () => {
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));
    expect(within(dialog).getByText("Enter a reason.")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Reason"), "S");

    expect(
      within(dialog).queryByText("Enter a reason."),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Reason")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("offers nothing enabled to close the dialog while the request runs", async () => {
    const pending = Promise.withResolvers<unknown>();
    setAdminPreprodAccessActionMock.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await submitReason(user, dialog, "SOK-3");

    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ ok: true, value: ON_AFTER_SWITCH });
      await pending.promise;
    });
  });

  it("calls the action with the target, the value and the trimmed reason, then says what Core holds and returns focus", async () => {
    // Core answers off although on was asked for: another admin got there first.
    setAdminPreprodAccessActionMock.mockResolvedValue({
      ok: true,
      value: OFF_WITH_HISTORY,
    });
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await submitReason(user, dialog, "  SOK-3  ");

    expect(setAdminPreprodAccessActionMock).toHaveBeenCalledWith({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "SOK-3",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Preprod access is off.");
    expect(theSwitch()).not.toBeChecked();
    expect(theSwitch()).toHaveFocus();
  });

  it("returns focus to the switch after a successful change while the page is still rendering again", async () => {
    // Next applies the action's refreshed page in a transition React joins to
    // the section's, so the section is still pending when the dialog closes.
    const refreshedPage = Promise.withResolvers<void>();
    setAdminPreprodAccessActionMock.mockImplementation(async () => {
      startTransition(async () => {
        await refreshedPage.promise;
      });
      return { ok: true, value: ON_AFTER_SWITCH };
    });
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await submitReason(user, dialog, "SOK-3");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(theSwitch()).toHaveFocus();
    await act(async () => {
      refreshedPage.resolve();
      await refreshedPage.promise;
    });
  });

  it("moves focus to Retry when the read after a successful change failed", async () => {
    const answer = Promise.withResolvers<unknown>();
    setAdminPreprodAccessActionMock.mockReturnValue(answer.promise);
    const user = userEvent.setup();
    const { rerender } = render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);
    await submitReason(user, dialog, "SOK-3");

    // The action's refreshed page arrives with a read Core did not answer.
    rerender(section(null));
    await act(async () => {
      answer.resolve({ ok: true, value: ON_AFTER_SWITCH });
      await answer.promise;
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  });

  it.each([
    [
      CommonErrorCode.UNAUTHORIZED,
      "Not allowed: only an admin signed in as themselves can change Preprod access.",
    ],
    [CommonErrorCode.NOT_FOUND, "This user no longer exists."],
    [
      CommonErrorCode.BAD_INPUT,
      "The change was not accepted. Check the reason and try again.",
    ],
  ])(
    "shows %s in the reader's words only and keeps the switch where Core holds it",
    async (code, readable) => {
      setAdminPreprodAccessActionMock.mockResolvedValue({
        ok: false,
        error: { code, message: "Raw Core text" },
      });
      const user = userEvent.setup();
      render(section(OFF_WITH_HISTORY));
      const dialog = await openDialog(user);

      await submitReason(user, dialog, "SOK-3");

      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(readable);
      expect(dialog).not.toHaveTextContent("Raw Core text");
      expect(theSwitch()).not.toBeChecked();
      expect(historyItems()).toHaveLength(2);
      expect(refreshPageMock).not.toHaveBeenCalled();
    },
  );

  it("reads the page again when the answer is lost", async () => {
    setAdminPreprodAccessActionMock.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    render(section(OFF_NO_HISTORY));
    const dialog = await openDialog(user);

    await submitReason(user, dialog, "SOK-3");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The change could not be saved. Try again.",
    );
    expect(refreshPageMock).toHaveBeenCalledTimes(1);
    expect(theSwitch()).not.toBeChecked();
  });
});
