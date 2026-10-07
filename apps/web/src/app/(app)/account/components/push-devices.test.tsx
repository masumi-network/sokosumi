import type { PushDevice } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { createFormats } from "@/i18n/time-format";
import { PushDevices } from "./push-devices";

const { listPushDevices, revokePushDevice, handleRevokedPushDevice } =
  vi.hoisted(() => ({
    listPushDevices: vi.fn(),
    revokePushDevice: vi.fn(),
    handleRevokedPushDevice: vi.fn(),
  }));
vi.mock("@/lib/services/push-devices.service", () => ({
  listPushDevices,
  revokePushDevice,
}));
vi.mock("@/lib/ably/push-revocation.client", () => ({
  handleRevokedPushDevice,
}));
const device: PushDevice = {
  id: "device-1",
  platform: "browser",
  formFactor: "desktop",
  state: "active",
};
const clients: QueryClient[] = [];
function setup(userId = "user-1", expanded = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  function view(id: string) {
    return (
      <NextIntlClientProvider
        locale="en"
        timeZone="Europe/Prague"
        formats={createFormats("h23")}
        messages={{
          App: { Account: { PushDevices: messages.App.Account.PushDevices } },
        }}
      >
        <QueryClientProvider client={client}>
          <PushDevices userId={id} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  const result = render(view(userId));
  if (expanded)
    fireEvent.click(screen.getByRole("button", { name: "Registered devices" }));
  return { ...result, switchUser: (id: string) => result.rerender(view(id)) };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  listPushDevices.mockResolvedValue([device]);
  revokePushDevice.mockResolvedValue(undefined);
  handleRevokedPushDevice.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("push devices in notification settings", () => {
  it("puts this device first without reordering other devices or mutating the response", async () => {
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device-1" }),
    );
    localStorage.setItem("sokosumi.push.deviceOwner", "user-1");
    const devices = [
      {
        ...device,
        id: "other-a",
        browserDetails: { browser: "Firefox", operatingSystem: "Windows" },
      },
      {
        ...device,
        id: "other-b",
        browserDetails: { browser: "Safari", operatingSystem: "iOS" },
      },
      {
        ...device,
        browserDetails: { browser: "Chrome", operatingSystem: "macOS" },
      },
    ];
    listPushDevices.mockResolvedValue(devices);
    setup();
    await screen.findByRole("list");
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Chrome on macOS");
    expect(rows[0].textContent).toContain("This device");
    expect(rows[1].textContent).toContain("Firefox on Windows");
    expect(rows[2].textContent).toContain("Safari on iOS");
    expect(devices.map(({ id }) => id)).toEqual([
      "other-a",
      "other-b",
      "device-1",
    ]);
  });

  it("shows the registration date in the reader's time zone and an honest fallback for older devices", async () => {
    listPushDevices.mockResolvedValue([
      { ...device, registeredAt: new Date("2026-09-27T10:30:00.000Z") },
      { ...device, id: "older-device" },
    ]);
    setup();
    const registered = await screen.findByText(
      "Registered Sep 27, 2026, 12:30",
    );
    expect(registered.tagName).toBe("TIME");
    expect(registered.getAttribute("dateTime")).toBe(
      "2026-09-27T10:30:00.000Z",
    );
    expect(screen.getByText("Registration date unavailable")).toBeTruthy();
  });

  it("starts collapsed and fetches only after the reader opens it", async () => {
    setup("user-1", false);
    const trigger = screen.getByRole("button", { name: "Registered devices" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(listPushDevices).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    expect(await screen.findByRole("list")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Refresh" }),
    );
    await userEvent.click(trigger);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows browser names and retains generic labels for older registrations", async () => {
    listPushDevices.mockResolvedValue([
      {
        ...device,
        browserDetails: { browser: "Chrome", operatingSystem: "macOS" },
      },
      { ...device, id: "old" },
    ]);
    setup();
    expect(await screen.findByText("Chrome on macOS")).toBeTruthy();
    expect(screen.getByText("Browser (Desktop)")).toBeTruthy();
  });

  it("lists registration states and marks only this owner's current device", async () => {
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device-1" }),
    );
    localStorage.setItem("sokosumi.push.deviceOwner", "user-1");
    listPushDevices.mockResolvedValue([
      device,
      { ...device, id: "device-2", state: "failing" },
      { ...device, id: "device-3", state: "failed" },
      { ...device, id: "device-4", state: "unknown" },
    ]);
    setup();
    expect(await screen.findByRole("list")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByText("This device")).toHaveLength(1);
    expect(screen.queryByText("Registered")).toBeNull();
    expect(screen.getByText("Delivery problems")).toBeTruthy();
    expect(screen.getByText("Delivery failed")).toBeTruthy();
    expect(screen.getByText("Status unknown")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Remove Browser (Desktop)" }),
    ).toHaveLength(4);
  });
  it("does not mark a previous owner's device as current", async () => {
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device-1" }),
    );
    localStorage.setItem("sokosumi.push.deviceOwner", "user-2");
    setup();
    await screen.findByRole("list");
    expect(screen.queryByText("This device")).toBeNull();
  });
  it("shows loading in Refresh and announces it without a visible loading row", async () => {
    let resolveDevices: (devices: PushDevice[]) => void = () => {};
    listPushDevices.mockReturnValue(
      new Promise<PushDevice[]>((resolve) => {
        resolveDevices = resolve;
      }),
    );
    setup();
    const refresh = screen.getByRole("button", { name: "Refresh" });
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading devices…");
    expect(status.classList.contains("sr-only")).toBe(true);
    expect(refresh.getAttribute("aria-disabled")).toBe("true");
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(
      refresh.querySelector('[data-slot="button-loading-bar"]'),
    ).not.toBeNull();
    expect(screen.queryByText(/No registered devices found/)).toBeNull();
    fireEvent.click(refresh);
    expect(listPushDevices).toHaveBeenCalledTimes(1);

    resolveDevices([device]);
    await screen.findByRole("list");
    expect(refresh.hasAttribute("disabled")).toBe(false);
    expect(refresh.hasAttribute("aria-disabled")).toBe(false);
    expect(refresh.hasAttribute("aria-busy")).toBe(false);
    expect(
      refresh.querySelector('[data-slot="button-loading-bar"]'),
    ).toBeNull();
    expect(status.textContent).toBe("");
  });
  it("shows an empty state when no devices are registered", async () => {
    listPushDevices.mockResolvedValue([]);
    setup();
    expect(await screen.findByText(/No registered devices found/)).toBeTruthy();
    expect(
      screen.getByText(
        "Turn on push notifications in a browser to register it here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("shows a recoverable error and retries only when requested", async () => {
    listPushDevices.mockRejectedValueOnce(new Error("upstream secret"));
    setup();
    expect(
      await screen.findByText(
        "Unable to load devices. Try refreshing the list.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("upstream secret")).toBeNull();
    expect(listPushDevices).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("list")).toBeTruthy();
    expect(listPushDevices).toHaveBeenCalledTimes(2);
  });
  it("does not present cached registration health as current after a failed refresh", async () => {
    setup();
    await screen.findByRole("list");
    listPushDevices.mockRejectedValueOnce(new Error("unavailable"));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Unable to load devices. Try refreshing the list.");
    expect(screen.queryByRole("list")).toBeNull();
  });
  it("does not reuse another user's device list", async () => {
    const result = setup();
    await screen.findByRole("list");
    listPushDevices.mockResolvedValue([
      {
        ...device,
        id: "other-device",
        browserDetails: { browser: "Firefox", operatingSystem: "Windows" },
      },
    ]);
    result.switchUser("user-2");
    await waitFor(() =>
      expect(
        within(screen.getByRole("list")).queryByText("Browser (Desktop)"),
      ).toBeNull(),
    );
    expect(await screen.findByText("Firefox on Windows")).toBeTruthy();
    expect(listPushDevices).toHaveBeenCalledTimes(2);
  });
  it("names the target, focuses Cancel, and returns focus without removing on Escape", async () => {
    listPushDevices.mockResolvedValue([
      {
        ...device,
        browserDetails: { browser: "Chrome", operatingSystem: "macOS" },
      },
    ]);
    setup();
    const trigger = await screen.findByRole("button", {
      name: "Remove Chrome on macOS",
    });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove this device?",
    });
    expect(
      within(dialog).getByText(
        "Push notifications will stop on Chrome on macOS. You can turn them on again from that device.",
      ),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(revokePushDevice).not.toHaveBeenCalled();
  });

  it("prevents duplicate removal while pending and immediately removes the row before a slow refresh", async () => {
    let resolveRemoval: () => void = () => {};
    revokePushDevice.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRemoval = resolve;
      }),
    );
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    const confirm = screen.getByRole("button", { name: "Remove device" });
    await userEvent.click(confirm);
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(
      confirm.querySelector('[data-slot="button-loading-bar"]'),
    ).not.toBeNull();
    fireEvent.click(confirm);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(revokePushDevice).toHaveBeenCalledTimes(1);
    expect(revokePushDevice).toHaveBeenCalledWith("device-1");
    listPushDevices.mockReturnValue(new Promise<PushDevice[]>(() => {}));
    resolveRemoval();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Registered devices" }),
    );
    expect(handleRevokedPushDevice).not.toHaveBeenCalled();
    expect(listPushDevices).toHaveBeenCalledTimes(2);
  });

  it("keeps failed removal open with a safe error and lets the reader retry", async () => {
    revokePushDevice.mockRejectedValueOnce(new Error("provider secret"));
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove device" }),
    );
    const message = await screen.findByText(
      "Unable to remove this device. Check your connection and try again.",
    );
    expect(message.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("provider secret")).toBeNull();
    listPushDevices.mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove device" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(revokePushDevice).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("No registered devices found."),
    ).toBeTruthy();
  });

  it("turns this browser off after server removal and does not retry a successful revoke when local cleanup fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device-1" }),
    );
    localStorage.setItem("sokosumi.push.deviceOwner", "user-1");
    handleRevokedPushDevice.mockRejectedValueOnce(
      new Error("local cleanup failed"),
    );
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    listPushDevices.mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove device" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(handleRevokedPushDevice).toHaveBeenCalledWith("user-1");
    expect(revokePushDevice).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      "Unable to clean up the removed push device in this browser",
    );
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(
      screen.queryByText(
        "Unable to remove this device. Check your connection and try again.",
      ),
    ).toBeNull();
  });
  it("discards an older list response after successful removal", async () => {
    setup();
    await screen.findByRole("list");
    let resolveStaleRead: (devices: PushDevice[]) => void = () => {};
    listPushDevices.mockReturnValueOnce(
      new Promise<PushDevice[]>((resolve) => {
        resolveStaleRead = resolve;
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    listPushDevices.mockResolvedValue([]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove device" }),
    );
    await screen.findByText("No registered devices found.");
    resolveStaleRead([device]);
    await waitFor(() => expect(screen.queryByRole("listitem")).toBeNull());
    expect(listPushDevices).toHaveBeenCalledTimes(3);
  });

  it("closes an old account's confirmation when the account changes", async () => {
    const result = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    listPushDevices.mockResolvedValue([]);
    result.switchUser("user-2");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(revokePushDevice).not.toHaveBeenCalled();
  });
  it("finishes removal while local browser cleanup is still waiting", async () => {
    localStorage.setItem(
      "ably.push.deviceId",
      JSON.stringify({ value: "device-1" }),
    );
    localStorage.setItem("sokosumi.push.deviceOwner", "user-1");
    const otherDevice = {
      ...device,
      id: "other-device",
      browserDetails: { browser: "Safari", operatingSystem: "iOS" },
    };
    listPushDevices.mockResolvedValue([device, otherDevice]);
    handleRevokedPushDevice.mockReturnValue(new Promise<void>(() => {}));
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove Browser (Desktop)" }),
    );
    listPushDevices.mockResolvedValue([otherDevice]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove device" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(handleRevokedPushDevice).toHaveBeenCalledWith("user-1");
    expect(
      screen.queryByRole("button", { name: "Remove Browser (Desktop)" }),
    ).toBeNull();
    const remaining = screen.getByRole("button", {
      name: "Remove Safari on iOS",
    });
    expect(remaining.hasAttribute("disabled")).toBe(false);
    await userEvent.click(remaining);
    expect(
      screen
        .getByRole("button", { name: "Remove device" })
        .hasAttribute("aria-busy"),
    ).toBe(false);
  });
});
