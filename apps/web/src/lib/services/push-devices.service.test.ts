import { beforeEach, expect, it, vi } from "vitest";
import {
  listPushDevices,
  updatePushDeviceBrowser,
} from "./push-devices.service";

const { getPushDevices, update } = vi.hoisted(() => ({
  getPushDevices: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: {
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
