import { beforeEach, expect, it, vi } from "vitest";
import { updatePushDeviceBrowser } from "./push-device-browser";

const { get, list, request } = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  request: vi.fn(),
}));
vi.mock("./client", () => ({
  getPushAdminRestClient: () => ({
    request,
    push: {
      admin: { deviceRegistrations: { get }, channelSubscriptions: { list } },
    },
  }),
}));
vi.mock("./notification-channel-environment", () => ({
  getNotificationChannelEnvironment: () => ({
    network: "all",
    vercelEnv: "production",
  }),
}));
const details = { browser: "Chrome", operatingSystem: "macOS" } as const;
const channel = "notifications:all:user_user-1";
const device = {
  id: "device-1",
  clientId: "user-1:tab",
  platform: "browser",
  metadata: { existing: "keep" },
  push: { recipient: { private: "secret" } },
};
beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue(device);
  list.mockResolvedValue({
    items: [{ channel, deviceId: device.id }],
    next: vi.fn(),
  });
  request.mockResolvedValue({ success: true, statusCode: 200 });
});
it("checks ownership and subscription, and patches only merged metadata", async () => {
  await updatePushDeviceBrowser("user-1", device.id, details);
  expect(list).toHaveBeenCalledWith({ channel, deviceId: device.id, limit: 1 });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "patch",
    "/push/deviceRegistrations/device-1",
    2,
    {},
    { metadata: { existing: "keep", sokosumiBrowser: details } },
  );
});
it.each([
  { clientId: "user-10:tab" },
  { clientId: undefined },
  { id: "other" },
  { platform: "ios" },
])("rejects foreign or non-browser registrations: %j", async (override) => {
  get.mockResolvedValue({ ...device, ...override });
  await expect(
    updatePushDeviceBrowser("user-1", device.id, details),
  ).rejects.toMatchObject({ status: 404 });
  expect(request).not.toHaveBeenCalled();
});
it("rejects a device without this environment's exact subscription", async () => {
  list.mockResolvedValue({
    items: [
      { channel: "notifications:other:user_user-1", deviceId: device.id },
    ],
    next: vi.fn().mockResolvedValue(null),
  });
  await expect(
    updatePushDeviceBrowser("user-1", device.id, details),
  ).rejects.toMatchObject({ status: 404 });
  expect(request).not.toHaveBeenCalled();
});
it("follows empty subscription pages", async () => {
  list.mockResolvedValueOnce({
    items: [],
    next: vi.fn().mockResolvedValue({
      items: [{ channel, deviceId: device.id }],
      next: vi.fn(),
    }),
  });
  await expect(
    updatePushDeviceBrowser("user-1", device.id, details),
  ).resolves.toBeUndefined();
});
it("ignores malformed old metadata", async () => {
  get.mockResolvedValue({ ...device, metadata: "bad" });
  await updatePushDeviceBrowser("user-1", device.id, details);
  expect(request.mock.calls[0][4]).toEqual({
    metadata: { sokosumiBrowser: details },
  });
});
it.each([get, list, request])("hides upstream failures", async (operation) => {
  operation.mockRejectedValue({ statusCode: 500, message: "secret" });
  await expect(
    updatePushDeviceBrowser("user-1", device.id, details),
  ).rejects.toMatchObject({
    status: 502,
    message: "Unable to update push device",
  });
});
it.each([404, 403, 500])(
  "handles unsuccessful PATCH status %s",
  async (statusCode) => {
    request.mockResolvedValue({ success: false, statusCode });
    await expect(
      updatePushDeviceBrowser("user-1", device.id, details),
    ).rejects.toMatchObject({ status: statusCode === 404 ? 404 : 502 });
  },
);

it("records a registration date without browser names and preserves metadata", async () => {
  const registeredAt = "2026-09-27T12:00:00.000Z";
  get.mockResolvedValue({
    ...device,
    metadata: { existing: "keep", sokosumiBrowser: details },
  });
  await updatePushDeviceBrowser("user-1", device.id, { registeredAt });
  expect(request.mock.calls[0][4]).toEqual({
    metadata: {
      existing: "keep",
      sokosumiBrowser: details,
      sokosumiRegisteredAt: registeredAt,
    },
  });
});
it("preserves an existing registration date during later browser updates", async () => {
  const registeredAt = "2026-09-26T12:00:00.000Z";
  get.mockResolvedValue({
    ...device,
    metadata: { existing: "keep", sokosumiRegisteredAt: registeredAt },
  });
  await updatePushDeviceBrowser("user-1", device.id, {
    ...details,
    registeredAt: "2026-09-27T12:00:00.000Z",
  });
  expect(request.mock.calls[0][4]).toEqual({
    metadata: {
      existing: "keep",
      sokosumiBrowser: details,
      sokosumiRegisteredAt: registeredAt,
    },
  });
});
it("replaces an invalid stored date with an observed registration date", async () => {
  const registeredAt = "2026-09-27T12:00:00.000Z";
  get.mockResolvedValue({
    ...device,
    metadata: { sokosumiRegisteredAt: "invalid" },
  });
  await updatePushDeviceBrowser("user-1", device.id, { registeredAt });
  expect(request.mock.calls[0][4]).toEqual({
    metadata: { sokosumiRegisteredAt: registeredAt },
  });
});
