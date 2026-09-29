import { afterEach, expect, it, vi } from "vitest";
import {
  getPushDeviceBrowserDetails,
  recordPushDeviceBrowser,
} from "./push-device-browser.client";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/services/push-devices.service", () => ({
  updatePushDeviceBrowser: update,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it.each([
  [
    "Macintosh; Intel Mac OS X 10_15_7 Chrome/140.0 Safari/537.36",
    "Chrome",
    "macOS",
    0,
  ],
  [
    "Windows NT 10.0 Chrome/140.0 Safari/537.36 Edg/140.0",
    "Edge",
    "Windows",
    0,
  ],
  [
    "Android 14 Chrome/140.0 Safari/537.36 SamsungBrowser/28.0",
    "Samsung Internet",
    "Android",
    0,
  ],
  ["Linux Chrome/140.0 Safari/537.36 OPR/120.0", "Opera", "Linux", 0],
  [
    "iPhone; CPU iPhone OS 18_0 like Mac OS X FxiOS/140.0 Safari/605",
    "Firefox",
    "iOS",
    0,
  ],
  [
    "iPhone; CPU iPhone OS 18_0 like Mac OS X CriOS/140.0 Safari/605",
    "Chrome",
    "iOS",
    0,
  ],
  [
    "Macintosh; Intel Mac OS X 10_15_7 Version/18.0 Safari/605",
    "Safari",
    "iOS",
    5,
  ],
  [
    "Macintosh; Intel Mac OS X 10_15_7 Version/18.0 Safari/605",
    "Safari",
    "macOS",
    0,
  ],
  ["X11; CrOS x86_64 Chrome/140.0 Safari/537.36", "Chrome", "ChromeOS", 0],
])(
  "detects coarse browser and OS: %s",
  (userAgent, browser, operatingSystem, maxTouchPoints) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
    expect(getPushDeviceBrowserDetails()).toEqual({ browser, operatingSystem });
  },
);
it.each([
  undefined,
  { userAgent: "unknown" },
  { userAgent: "unknown OS Chrome/140" },
])("leaves unknown devices generic: %j", (navigator) => {
  vi.stubGlobal("navigator", navigator);
  expect(getPushDeviceBrowserDetails()).toBeNull();
});
it("records only names for this user's registration", async () => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh Chrome/140" });
  const client = {
    getDevice: vi.fn().mockResolvedValue({
      id: "device",
      clientId: "user-1:tab",
      deviceSecret: "secret",
    }),
  };
  await recordPushDeviceBrowser(client, "user-1");
  expect(update).toHaveBeenCalledExactlyOnceWith("device", {
    browser: "Chrome",
    operatingSystem: "macOS",
  });
});
it("does not update a device belonging to another account", async () => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh Chrome/140" });
  await recordPushDeviceBrowser(
    {
      getDevice: vi
        .fn()
        .mockResolvedValue({ id: "device", clientId: "user-10:tab" }),
    },
    "user-1",
  );
  expect(update).not.toHaveBeenCalled();
});

it("records registration time even when browser names are unknown", async () => {
  vi.stubGlobal("navigator", { userAgent: "unknown" });
  const registeredAt = new Date("2026-09-27T12:00:00.000Z");
  await recordPushDeviceBrowser(
    {
      getDevice: vi
        .fn()
        .mockResolvedValue({ id: "device", clientId: "user-1:tab" }),
    },
    "user-1",
    registeredAt,
  );
  expect(update).toHaveBeenCalledExactlyOnceWith("device", { registeredAt });
});
it("records browser details and registration time together", async () => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh Chrome/140" });
  const registeredAt = new Date("2026-09-27T12:00:00.000Z");
  await recordPushDeviceBrowser(
    {
      getDevice: vi
        .fn()
        .mockResolvedValue({ id: "device", clientId: "user-1:tab" }),
    },
    "user-1",
    registeredAt,
  );
  expect(update).toHaveBeenCalledExactlyOnceWith("device", {
    browser: "Chrome",
    operatingSystem: "macOS",
    registeredAt,
  });
});
it("skips an empty update when browser names and registration date are unknown", async () => {
  vi.stubGlobal("navigator", { userAgent: "unknown" });
  const getDevice = vi.fn();
  await recordPushDeviceBrowser({ getDevice }, "user-1");
  expect(getDevice).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
