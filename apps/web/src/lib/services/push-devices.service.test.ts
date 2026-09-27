import { beforeEach, expect, it, vi } from "vitest";
import {
  beginPushActivation,
  listPushDevices,
  revokePushDevice,
  subscribePushDevice,
  updatePushDeviceBrowser,
} from "./push-devices.service";

const { getPushDevices, update, begin, subscribe, revoke } = vi.hoisted(() => ({
  begin: vi.fn(),
  subscribe: vi.fn(),
  revoke: vi.fn(),
  getPushDevices: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
    beginPushActivation: begin,
    subscribePushDevice: subscribe,
    revokePushDevice: revoke,
    getPushDevices,
    updatePushDeviceBrowser: update,
  },
}));
beforeEach(() => vi.resetAllMocks());
it("returns Core device DTOs without dropping device state", async () => {
  const devices = [
    { id: "a", platform: "browser", formFactor: "desktop", state: "failing" },
  ];
  getPushDevices.mockResolvedValue({ data: devices });
  expect(await listPushDevices()).toBe(devices);
});
it("propagates errors instead of reporting no registered devices", async () => {
  const error = new Error("unavailable");
  getPushDevices.mockRejectedValue(error);
  await expect(listPushDevices()).rejects.toBe(error);
});

it("forwards browser details and propagates update failures", async () => {
  const details = { browser: "Chrome", operatingSystem: "macOS" } as const;
  await updatePushDeviceBrowser("device", details);
  expect(update).toHaveBeenCalledWith({ id: "device" }, details);
  update.mockRejectedValueOnce(new Error("offline"));
  await expect(updatePushDeviceBrowser("device", details)).rejects.toThrow(
    "offline",
  );
});

it("forwards registration dates for unknown browsers", async () => {
  const details = { registeredAt: new Date("2026-09-27T12:00:00.000Z") };
  await updatePushDeviceBrowser("device", details);
  expect(update).toHaveBeenCalledExactlyOnceWith({ id: "device" }, details);
});

it("retains the activation revision and replacement instruction", async () => {
  const input = { deviceId: "old", readerInitiated: true };
  const result = {
    id: "consent",
    revision: 3,
    revoked: false,
    replaceDevice: true,
  };
  begin.mockResolvedValue({ data: result });
  expect(await beginPushActivation(input)).toBe(result);
  expect(begin).toHaveBeenCalledExactlyOnceWith(input);
});
it("preserves an authoritative binding refusal", async () => {
  const input = { consentId: "consent", revision: 1 };
  subscribe.mockResolvedValue({ data: { subscribed: false } });
  expect(await subscribePushDevice("device", input)).toBe(false);
  expect(subscribe).toHaveBeenCalledExactlyOnceWith({ id: "device" }, input);
});
it("forwards revocation and does not hide failed cleanup", async () => {
  await revokePushDevice("device");
  expect(revoke).toHaveBeenCalledExactlyOnceWith({ id: "device" });
  revoke.mockRejectedValueOnce(new Error("offline"));
  await expect(revokePushDevice("device")).rejects.toThrow("offline");
});
