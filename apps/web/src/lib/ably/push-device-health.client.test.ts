import Ably from "ably";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findPushDeviceFault,
  isMissingPushDevice,
} from "./push-device-health.client";

const { getSubscription, getDevice, request, getWorker } = vi.hoisted(() => ({
  getSubscription: vi.fn(),
  getDevice: vi.fn(),
  request: vi.fn(),
  getWorker: vi.fn(),
}));

vi.mock("@/lib/utils/notification-service-worker", () => ({
  getExistingNotificationServiceWorker: getWorker,
}));
vi.mock("ably", () => ({
  default: {
    Rest: vi.fn(function Rest() {
      return { getDevice, request };
    }),
  },
}));

const ENDPOINT = "https://push.example/subscription";
const client = new Ably.Rest({});

function remoteDevice(state = "Active", endpoint = ENDPOINT) {
  return {
    clientId: "reader:old-instance",
    push: {
      state,
      recipient: { transportType: "web", targetUrl: btoa(endpoint) },
    },
  };
}

describe("findPushDeviceFault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getWorker.mockResolvedValue({
      pushManager: { getSubscription },
    });
    getSubscription.mockResolvedValue({ endpoint: ENDPOINT });
    getDevice.mockResolvedValue({
      id: "device/with spaces",
      deviceIdentityToken: "device-token",
    });
    request.mockResolvedValue({
      statusCode: 200,
      success: true,
      items: [remoteDevice()],
    });
  });

  it("keeps an active registration and authenticates only the local device", async () => {
    expect(await findPushDeviceFault(client, "reader")).toBeNull();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "get",
      "/push/deviceRegistrations/device%2Fwith%20spaces",
      2,
      {},
      undefined,
      { authorization: `Bearer ${btoa("device-token")}` },
    );
  });

  it.each(["Failed", "FAILED", "failed"])(
    "resets a remotely %s device even while the browser subscription exists",
    async (state) => {
      request.mockResolvedValue({
        statusCode: 200,
        success: true,
        items: [remoteDevice(state)],
      });
      expect(await findPushDeviceFault(client, "reader")).toBe(
        "delivery-failed",
      );
    },
  );

  it("preserves a temporarily failing registration", async () => {
    request.mockResolvedValue({
      statusCode: 200,
      success: true,
      items: [remoteDevice("Failing")],
    });
    expect(await findPushDeviceFault(client, "reader")).toBeNull();
  });

  it("resets a registration whose endpoint no longer matches the browser", async () => {
    request.mockResolvedValue({
      statusCode: 200,
      success: true,
      items: [remoteDevice("Active", "https://push.example/expired")],
    });
    expect(await findPushDeviceFault(client, "reader")).toBe("endpoint-moved");
  });

  it.each(["other:instance", "reader-other:instance"])(
    "resets a registration another reader owns: %s",
    async (clientId) => {
      request.mockResolvedValue({
        statusCode: 200,
        success: true,
        items: [{ ...remoteDevice(), clientId }],
      });
      expect(await findPushDeviceFault(client, "reader")).toBe(
        "another-reader",
      );
    },
  );

  // SOK-1152: a device-authenticated read carries no clientId, so treating
  // absence as a foreign device left the repair resetting a healthy
  // registration for as long as the reader kept pressing.
  it.each([undefined, null, ""])(
    "keeps a registration Ably reports without a clientId: %s",
    async (clientId) => {
      request.mockResolvedValue({
        statusCode: 200,
        success: true,
        items: [{ ...remoteDevice(), clientId }],
      });
      expect(await findPushDeviceFault(client, "reader")).toBeNull();
    },
  );

  it("rejects an unknown remote push state instead of calling it healthy", async () => {
    request.mockResolvedValue({
      statusCode: 200,
      success: true,
      items: [remoteDevice("unknown")],
    });
    await expect(findPushDeviceFault(client, "reader")).rejects.toThrow();
  });

  it.each([401, 404])(
    "resets a missing device credential (%s)",
    async (statusCode) => {
      request.mockResolvedValue({ statusCode, success: false, items: [] });
      expect(await findPushDeviceFault(client, "reader")).toBe(
        "unknown-to-ably",
      );
    },
  );

  it("resets a missing browser subscription without a remote request", async () => {
    getSubscription.mockResolvedValue(null);
    expect(await findPushDeviceFault(client, "reader")).toBe(
      "no-browser-subscription",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("resets when the service worker is absent", async () => {
    getWorker.mockResolvedValue(null);
    expect(await findPushDeviceFault(client, "reader")).toBe(
      "no-browser-subscription",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("resets a missing device identity token without a remote request", async () => {
    getDevice.mockResolvedValue({ id: "device" });
    expect(await findPushDeviceFault(client, "reader")).toBe("no-device-token");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([403, 429, 500, 503])(
    "does not treat an unsuccessful health check (%s) as a reset decision",
    async (statusCode) => {
      request.mockResolvedValue({ statusCode, success: false, items: [] });
      await expect(findPushDeviceFault(client, "reader")).rejects.toThrow(
        "Could not verify the push device registration",
      );
    },
  );

  it("propagates network errors without a reset decision", async () => {
    const offline = new Error("Offline");
    request.mockRejectedValue(offline);
    await expect(findPushDeviceFault(client, "reader")).rejects.toBe(offline);
  });

  it.each([
    { items: [] },
    { items: [{}] },
    {
      items: [
        { push: { state: "Active", recipient: { transportType: "apns" } } },
      ],
    },
  ])("rejects malformed remote device data: %j", async ({ items }) => {
    request.mockResolvedValue({ statusCode: 200, success: true, items });
    await expect(findPushDeviceFault(client, "reader")).rejects.toThrow();
  });
});

describe("isMissingPushDevice", () => {
  it.each([401, 404])(
    "accepts a missing or invalid credential: %s",
    (statusCode) => {
      expect(isMissingPushDevice({ statusCode })).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    "404",
    {},
    { statusCode: "404" },
    { statusCode: 500 },
  ])("does not bypass remote deletion for an unrelated error: %j", (error) => {
    expect(isMissingPushDevice(error)).toBe(false);
  });
});
