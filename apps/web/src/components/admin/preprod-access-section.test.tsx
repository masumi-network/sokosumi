import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setAdminPreprodAccessActionMock } = vi.hoisted(() => ({
  setAdminPreprodAccessActionMock: vi.fn(),
}));

vi.mock("@/lib/actions/admin-preprod-access/action", () => ({
  setAdminPreprodAccessAction: setAdminPreprodAccessActionMock,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

function renderSection(access: AdminPreprodAccess) {
  return render(
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
    </NextIntlClientProvider>,
  );
}

// An open dialog hides the page behind it from the accessibility tree.
function historyItems() {
  return within(screen.getByRole("list", { hidden: true })).getAllByRole(
    "listitem",
    { hidden: true },
  );
}

function theSwitch(name: "On" | "Off") {
  return screen.getByRole("switch", { name, hidden: true });
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(theSwitch("Off"));
  return await screen.findByRole("dialog");
}

describe("PreprodAccessSection", () => {
  beforeEach(() => {
    setAdminPreprodAccessActionMock.mockReset();
  });

  it("shows the flag and the history newest first, with a gone operator as unknown", () => {
    renderSection(OFF_WITH_HISTORY);

    expect(theSwitch("Off")).not.toBeChecked();
    const items = historyItems();
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Switched off by an unknown admin");
    expect(items[0]).toHaveTextContent("SOK-2 trial ended");
    expect(items[1]).toHaveTextContent("Switched on by Ada Admin");
    expect(items[1]).toHaveTextContent("SOK-1 trial");
  });

  it("says so in one line when there is no history", () => {
    renderSection(OFF_NO_HISTORY);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("No changes yet.")).toBeInTheDocument();
  });

  it("opens a dialog naming the target and the change, without flipping the switch", async () => {
    const user = userEvent.setup();
    renderSection(OFF_NO_HISTORY);

    const dialog = await openDialog(user);

    expect(
      within(dialog).getByText(/The user Grace Hopper gets Preprod access\./),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Ticket id, no personal details."),
    ).toBeInTheDocument();
    expect(theSwitch("Off")).not.toBeChecked();
  });

  it("sends nothing without a reason", async () => {
    const user = userEvent.setup();
    renderSection(OFF_NO_HISTORY);
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText("Reason"), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));

    expect(setAdminPreprodAccessActionMock).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Reason")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(within(dialog).getByText("Enter a reason.")).toBeInTheDocument();
  });

  it("calls the action with the target, the value and the trimmed reason, then shows the new state and record", async () => {
    setAdminPreprodAccessActionMock.mockResolvedValue({
      ok: true,
      value: ON_AFTER_SWITCH,
    });
    const user = userEvent.setup();
    renderSection(OFF_WITH_HISTORY);
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText("Reason"), "  SOK-3  ");
    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));

    expect(setAdminPreprodAccessActionMock).toHaveBeenCalledWith({
      target: { type: "user", id: "user_1" },
      enabled: true,
      reason: "SOK-3",
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(theSwitch("On")).toBeChecked();
    const items = historyItems();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Switched on by Ada Admin");
    expect(items[0]).toHaveTextContent("SOK-3");
  });

  it.each([
    [
      CommonErrorCode.UNAUTHORIZED,
      "Preprod access cannot be changed while impersonating",
      "Not allowed: only an admin signed in as themselves can change Preprod access.",
    ],
    [
      CommonErrorCode.NOT_FOUND,
      "User not found",
      "This user no longer exists.",
    ],
    [
      CommonErrorCode.BAD_INPUT,
      "Reason is required",
      "The change was not accepted. Check the reason and try again.",
    ],
  ])(
    "shows Core's %s with its message and keeps the switch where Core holds it",
    async (code, coreMessage, readable) => {
      setAdminPreprodAccessActionMock.mockResolvedValue({
        ok: false,
        error: { code, message: coreMessage },
      });
      const user = userEvent.setup();
      renderSection(OFF_WITH_HISTORY);
      const dialog = await openDialog(user);

      await user.type(within(dialog).getByLabelText("Reason"), "SOK-3");
      await user.click(
        within(dialog).getByRole("button", { name: "Switch on" }),
      );

      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(readable);
      expect(alert).toHaveTextContent(coreMessage);
      expect(theSwitch("Off")).not.toBeChecked();
      expect(historyItems()).toHaveLength(2);
    },
  );

  it("shows a failed request and keeps the switch off", async () => {
    setAdminPreprodAccessActionMock.mockRejectedValue(new Error("network"));
    const user = userEvent.setup();
    renderSection(OFF_NO_HISTORY);
    const dialog = await openDialog(user);

    await user.type(within(dialog).getByLabelText("Reason"), "SOK-3");
    await user.click(within(dialog).getByRole("button", { name: "Switch on" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The change could not be saved. Try again.",
    );
    expect(theSwitch("Off")).not.toBeChecked();
  });
});
