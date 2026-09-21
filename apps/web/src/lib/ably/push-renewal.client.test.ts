import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import Ably from "ably";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rememberPushRenewal, revokePushRenewal } from "./push-renewal.client";

const { getDevice, getWorker, getVersion } = vi.hoisted(() => ({
  getDevice: vi.fn(),
  getWorker: vi.fn(),
  getVersion: vi.fn(),
}));
vi.mock("ably", () => ({
  default: {
    Rest: vi.fn(function Rest() {
      return { getDevice };
    }),
  },
}));
vi.mock("@/lib/utils/notification-service-worker", () => ({
  getExistingNotificationServiceWorker: getWorker,
  forgetNotificationServiceWorker: vi.fn(),
}));
vi.mock("./push-work-queue.client", () => ({
  getPushTeardownVersion: getVersion,
}));

const client = new Ably.Rest({});
const oldEndpoint = "https://push.example/old";
const newEndpoint = "https://push.example/new";
const source = readFileSync(
  join(process.cwd(), "public/ably-push-renewal.js"),
  "utf8",
);
let databaseFactory: IDBFactory;
let subscription: ReturnType<typeof makeSubscription>;
const unregister = vi.fn(async () => true);
function makeSubscription(endpoint: string) {
  return {
    endpoint,
    unsubscribe: vi.fn(async () => true),
    getKey: vi.fn(() => new Uint8Array([251, 255]).buffer),
  };
}
async function readRecord(): Promise<Record<string, string> | undefined> {
  return new Promise((resolve, reject) => {
    const open = databaseFactory.open("sokosumi.push.renewal", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("device");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = open.result
        .transaction("device")
        .objectStore("device")
        .get("current");
      request.onsuccess = () => {
        open.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    };
  });
}
function worker() {
  let listener: (event: {
    oldSubscription: { endpoint: string } | null;
    waitUntil: (work: Promise<unknown>) => void;
  }) => void;
  const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => ({
    ok: true,
    status: 200,
  }));
  const pushManager = {
    getSubscription: vi.fn(
      async (): Promise<ReturnType<typeof makeSubscription> | null> =>
        subscription,
    ),
    subscribe: vi.fn(async () => subscription),
    permissionState: vi.fn(async () => "granted"),
  };
  const requestLock = vi.fn(
    async (_name: string, work: () => Promise<unknown>) => work(),
  );
  const context = createContext({
    indexedDB: databaseFactory,
    btoa,
    atob,
    Uint8Array,
    AbortSignal,
    console: { error: vi.fn() },
    fetch: fetchMock,
    self: {
      navigator: { locks: { request: requestLock } },
      registration: { pushManager },
      addEventListener: (name: string, callback: typeof listener) => {
        if (name === "pushsubscriptionchange") listener = callback;
      },
    },
  });
  runInContext(source, context);
  return {
    fetchMock,
    pushManager,
    requestLock,
    context,
    fire: async (endpoint: string | null = oldEndpoint) => {
      let pending: Promise<unknown> = Promise.resolve();
      listener({
        oldSubscription: endpoint ? { endpoint } : null,
        waitUntil: (work) => {
          pending = work;
        },
      });
      await pending;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseFactory = new IDBFactory();
  vi.stubGlobal("indexedDB", databaseFactory);
  subscription = makeSubscription(oldEndpoint);
  getVersion.mockReturnValue("current");
  getDevice.mockResolvedValue({
    id: "device/one",
    clientId: "reader:tab",
    deviceIdentityToken: "device-token",
    push: { recipient: { publicVapidKey: "AQID" } },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: getWorker },
  });
  getWorker.mockResolvedValue({
    unregister,
    pushManager: { getSubscription: async () => subscription },
  });
});

describe("worker renewal consent", () => {
  it("persists only a verified account's current browser endpoint", async () => {
    await rememberPushRenewal(client, "reader", "current");
    expect(await readRecord()).toMatchObject({
      userId: "reader",
      endpoint: oldEndpoint,
      deviceIdentityToken: "device-token",
    });
  });
  it("rejects another account and overtaken activations", async () => {
    await rememberPushRenewal(client, "other", "current");
    expect(await readRecord()).toBeUndefined();
    await rememberPushRenewal(client, "reader", "old");
    expect(await readRecord()).toBeUndefined();
  });
  it("clears a snapshot overtaken during its database write", async () => {
    getVersion.mockReturnValueOnce("current").mockReturnValue("off");
    await rememberPushRenewal(client, "reader", "current");
    expect(await readRecord()).toBeUndefined();
  });
  it("revokes renewal before any browser delivery teardown", async () => {
    await rememberPushRenewal(client, "reader", "current");
    await revokePushRenewal();
    expect(await readRecord()).toBeUndefined();
    expect(unregister).not.toHaveBeenCalled();
  });
  it("unregisters and unsubscribes if storage cannot revoke", async () => {
    vi.spyOn(databaseFactory, "open").mockImplementation(() => {
      throw new Error("unavailable");
    });
    await revokePushRenewal();
    expect(unregister).toHaveBeenCalledOnce();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(unregister.mock.invocationCallOrder[0]).toBeLessThan(
      subscription.unsubscribe.mock.invocationCallOrder[0],
    );
  });
});

describe("pushsubscriptionchange", () => {
  beforeEach(async () => {
    await rememberPushRenewal(client, "reader", "current");
    subscription = makeSubscription(newEndpoint);
  });
  it("updates the existing device with fresh endpoint and encryption keys", async () => {
    const instance = worker();
    await instance.fire();
    expect(instance.requestLock).toHaveBeenCalledWith(
      "sokosumi.push.work",
      expect.any(Function),
    );
    expect(instance.fetchMock).toHaveBeenCalledWith(
      "https://rest.ably.io/push/deviceRegistrations/device%2Fone",
      expect.objectContaining({
        method: "PATCH",
        credentials: "omit",
        headers: expect.objectContaining({
          Authorization: `Bearer ${btoa("device-token")}`,
        }),
      }),
    );
    const request = instance.fetchMock.mock.calls[0];
    const body = request?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(body)).toEqual({
      push: {
        recipient: {
          transportType: "web",
          targetUrl: btoa(newEndpoint),
          publicVapidKey: "AQID",
          encryptionKey: { p256dh: "+/8=", auth: "+/8=" },
        },
      },
    });
    expect(await readRecord()).toMatchObject({ endpoint: newEndpoint });
  });
  it("recreates a missing subscription using the stored VAPID key", async () => {
    const instance = worker();
    instance.pushManager.getSubscription.mockResolvedValueOnce(null);
    await instance.fire();
    expect(instance.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3]),
    });
    expect(instance.fetchMock).toHaveBeenCalledOnce();
  });
  it("ignores stale events and revoked permission", async () => {
    const instance = worker();
    await instance.fire("https://push.example/stale");
    instance.pushManager.permissionState.mockResolvedValue("denied");
    await instance.fire();
    expect(instance.fetchMock).not.toHaveBeenCalled();
    expect(instance.pushManager.subscribe).not.toHaveBeenCalled();
  });
  it("does nothing after logout or without cross-context locks", async () => {
    const instance = worker();
    await revokePushRenewal();
    await instance.fire();
    expect(instance.fetchMock).not.toHaveBeenCalled();
    runInContext("self.navigator.locks = undefined", instance.context);
    await instance.fire();
    expect(instance.requestLock).toHaveBeenCalledTimes(1);
  });
  it("stops a late browser subscription when logout overtakes subscribe", async () => {
    const instance = worker();
    instance.pushManager.getSubscription.mockResolvedValueOnce(null);
    instance.pushManager.subscribe.mockImplementationOnce(async () => {
      await revokePushRenewal();
      return subscription;
    });
    await instance.fire();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(instance.fetchMock).not.toHaveBeenCalled();
  });
  it("stops the replacement when logout overtakes the remote PATCH", async () => {
    const instance = worker();
    instance.fetchMock.mockImplementationOnce(async () => {
      await revokePushRenewal();
      return { ok: true, status: 200 };
    });
    await instance.fire();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(await readRecord()).toBeUndefined();
  });
  it("retains the old snapshot after a failed PATCH for foreground recovery", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await instance.fire();
    expect(await readRecord()).toMatchObject({ endpoint: oldEndpoint });
  });
});
