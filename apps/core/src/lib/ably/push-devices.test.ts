import { beforeEach, describe, expect, it, vi } from "vitest";
import { listPushDevices } from "./push-devices";

const { list, get, getClient, environment } = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  getClient: vi.fn(),
  environment: vi.fn(),
}));
vi.mock("./client", () => ({ getPushAdminRestClient: getClient }));
vi.mock("./notification-channel-environment", () => ({
  getNotificationChannelEnvironment: environment,
}));
const channel = "notifications:all:user_user-1";
function page(
  items: Array<{ channel: string; deviceId?: string; clientId?: string }>,
  next: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null),
) {
  return { items, next };
}
function device(
  id: string,
  clientId = "user-1:tab-1",
  state: string | undefined = "ACTIVE",
) {
  return {
    id,
    clientId,
    platform: "browser",
    formFactor: "desktop",
    deviceSecret: "secret",
    metadata: { private: true },
    push: {
      state,
      recipient: { targetUrl: "secret-endpoint" },
      error: { message: "private-error" },
    },
  };
}

describe("listPushDevices", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getClient.mockReturnValue({
      push: {
        admin: { channelSubscriptions: { list }, deviceRegistrations: { get } },
      },
    });
    environment.mockReturnValue({ network: "Preprod" });
    list.mockResolvedValue(page([]));
    get.mockImplementation(async (id: string) => device(id));
  });
  it("exposes only validated browser details", async () => {
    list.mockResolvedValue(
      page([
        { channel, deviceId: "a" },
        { channel, deviceId: "b" },
      ]),
    );
    get.mockImplementation(async (id: string) => ({
      ...device(id),
      metadata: {
        secret: "hidden",
        sokosumiBrowser:
          id === "a"
            ? { browser: "Chrome", operatingSystem: "macOS", secret: "hidden" }
            : { browser: "untrusted", operatingSystem: "macOS" },
      },
    }));
    const devices = await listPushDevices("user-1");
    expect(devices[0].browserDetails).toEqual({
      browser: "Chrome",
      operatingSystem: "macOS",
    });
    expect(devices[1].browserDetails).toBeUndefined();
    expect(JSON.stringify(devices)).not.toContain("hidden");
  });
  it.each([
    ["2026-09-27T12:00:00.000Z", "2026-09-27T12:00:00.000Z"],
    [undefined, undefined],
    [null, undefined],
    ["not-a-date", undefined],
    ["2026-02-30T12:00:00.000Z", undefined],
    [123, undefined],
  ])("returns only valid registration dates: %j", async (stored, expected) => {
    list.mockResolvedValue(page([{ channel, deviceId: "a" }]));
    get.mockResolvedValue({
      ...device("a"),
      metadata: { sokosumiRegisteredAt: stored },
    });
    expect((await listPushDevices("user-1"))[0].registeredAt).toBe(expected);
  });
  it("follows every page, deduplicates devices, and returns only public fields", async () => {
    const next = vi.fn().mockResolvedValue(
      page([
        { channel, deviceId: "b" },
        { channel, deviceId: "a" },
      ]),
    );
    list.mockResolvedValue(
      page(
        [
          { channel, deviceId: "b" },
          { channel, deviceId: "b" },
        ],
        next,
      ),
    );
    expect(await listPushDevices("user-1")).toEqual([
      { id: "a", platform: "browser", formFactor: "desktop", state: "active" },
      { id: "b", platform: "browser", formFactor: "desktop", state: "active" },
    ]);
    expect(list).toHaveBeenCalledWith({ channel, limit: 20 });
    expect(get).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledOnce();
  });
  it("follows an empty page and omits a device deleted between reads", async () => {
    const next = vi.fn().mockResolvedValue(
      page([
        { channel, deviceId: "deleted" },
        { channel, deviceId: "live" },
      ]),
    );
    list.mockResolvedValue(page([], next));
    get.mockImplementation(async (id: string) => {
      if (id === "deleted") throw { statusCode: 404 };
      return device(id);
    });
    expect(await listPushDevices("user-1")).toEqual([
      {
        id: "live",
        platform: "browser",
        formFactor: "desktop",
        state: "active",
      },
    ]);
  });
  it("rejects other channels, account switches, prefix lookalikes, and unbound registrations", async () => {
    list.mockResolvedValue(
      page([
        { channel: "notifications:all:user_other", deviceId: "other-channel" },
        { channel, clientId: "user-1:old-tab" },
        ...["other-owner", "prefix", "unbound", "wrong-id"].map((deviceId) => ({
          channel,
          deviceId,
        })),
      ]),
    );
    get.mockImplementation(async (id: string) => {
      if (id === "unbound") return { ...device(id), clientId: undefined };
      if (id === "wrong-id") return device("different");
      return device(id, id === "prefix" ? "user-10:tab" : "user-2:tab");
    });
    expect(await listPushDevices("user-1")).toEqual([]);
    expect(get).not.toHaveBeenCalledWith("other-channel");
  });
  it.each(["ACTIVE", "active", "FAILING", "failed"])(
    "normalizes state %s",
    async (state) => {
      list.mockResolvedValue(page([{ channel, deviceId: "a" }]));
      get.mockResolvedValue(device("a", "user-1:tab", state));
      expect((await listPushDevices("user-1"))[0]?.state).toBe(
        state.toLowerCase(),
      );
    },
  );
  it("reports missing health and unrecognized device types honestly", async () => {
    list.mockResolvedValue(page([{ channel, deviceId: "a" }]));
    get.mockResolvedValue({
      ...device("a"),
      platform: "future",
      formFactor: "future",
      push: {},
    });
    expect(await listPushDevices("user-1")).toEqual([
      { id: "a", platform: "unknown", formFactor: "other", state: "unknown" },
    ]);
  });
  it.each([401, 403, 429, 500])(
    "does not turn upstream %i into an empty list",
    async (statusCode) => {
      list.mockResolvedValue(page([{ channel, deviceId: "a" }]));
      get.mockRejectedValue({ statusCode, message: "secret-endpoint" });
      await expect(listPushDevices("user-1")).rejects.toMatchObject({
        status: 502,
        message: "Unable to retrieve push devices",
      });
    },
  );
  it("does not return partial data when a later page fails", async () => {
    list.mockResolvedValue(
      page(
        [{ channel, deviceId: "a" }],
        vi.fn().mockRejectedValue(new Error("private")),
      ),
    );
    await expect(listPushDevices("user-1")).rejects.toMatchObject({
      status: 502,
    });
  });
  it("limits listing to the current preview branch", async () => {
    environment.mockReturnValue({
      network: "Preprod",
      vercelEnv: "preview",
      vercelGitCommitRef: "sok-927-devices",
    });
    await listPushDevices("user-1");
    expect(list).toHaveBeenCalledWith({
      channel:
        "notifications:preview:preprod:branch_sok-927-devices:user_user-1",
      limit: 20,
    });
  });
  it("fails closed for a preview without a branch", async () => {
    environment.mockReturnValue({ network: "Preprod", vercelEnv: "preview" });
    await expect(listPushDevices("user-1")).rejects.toThrow();
    expect(list).not.toHaveBeenCalled();
  });
});
