import { beforeEach, expect, it, vi } from "vitest";
import { listPushDevices } from "./push-devices.service";

const { getPushDevices } = vi.hoisted(() => ({ getPushDevices: vi.fn() }));
vi.mock("@/lib/clients/core.notifications.browser.client", () => ({
  notificationsBrowserClient: { getPushDevices },
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
