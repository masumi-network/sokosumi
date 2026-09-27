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
import type { PushDevice } from "@/lib/clients/generated/core/types.gen";
import { PushDevices } from "./push-devices";

const { listPushDevices } = vi.hoisted(() => ({ listPushDevices: vi.fn() }));
vi.mock("@/lib/services/push-devices.service", () => ({ listPushDevices }));
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
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("push devices in notification settings", () => {
  it("starts collapsed and fetches only after the reader opens it", async () => {
    setup("user-1", false);
    const trigger = screen.getByRole("button", { name: "Registered devices" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(listPushDevices).not.toHaveBeenCalled();
    await userEvent.click(trigger);
    expect(await screen.findByRole("list")).toBeTruthy();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
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
    expect(screen.getByText("Registered")).toBeTruthy();
    expect(screen.getByText("Delivery problems")).toBeTruthy();
    expect(screen.getByText("Delivery failed")).toBeTruthy();
    expect(screen.getByText("Status unknown")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /remove|revoke|rename/i }),
    ).toBeNull();
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
  it("shows loading while a request is pending and prevents duplicate refresh", async () => {
    listPushDevices.mockReturnValue(new Promise(() => {}));
    setup();
    expect(screen.getByRole("status").textContent).toBe("Loading devices…");
    expect(
      screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByText(/No registered devices found/)).toBeNull();
  });
  it("shows an empty state when no devices are registered", async () => {
    listPushDevices.mockResolvedValue([]);
    setup();
    expect(await screen.findByText(/No registered devices found/)).toBeTruthy();
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
});
