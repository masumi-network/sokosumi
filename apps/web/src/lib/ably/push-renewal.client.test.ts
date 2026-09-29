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
  interface WorkerEvent {
    oldSubscription?: { endpoint: string } | null;
    tag?: string;
    waitUntil: (work: Promise<unknown>) => void;
  }
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const syncRegister = vi.fn(async (_tag: string) => {});
  const delay = vi.fn(async () => {});
  const retryDelays: number[] = [];
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
    setTimeout: (callback: () => void, milliseconds: number) => {
      retryDelays.push(milliseconds);
      void delay().then(callback);
    },
    btoa,
    atob,
    Uint8Array,
    AbortSignal,
    console: { error: vi.fn() },
    fetch: fetchMock,
    self: {
      navigator: { locks: { request: requestLock } },
      registration: { pushManager, sync: { register: syncRegister } },
      addEventListener: (
        name: string,
        callback: (event: WorkerEvent) => void,
      ) => {
        listeners.set(name, callback);
      },
    },
  });
  runInContext(source, context);
  return {
    fetchMock,
    syncRegister,
    delay,
    retryDelays,
    pushManager,
    requestLock,
    context,
    fire: async (endpoint: string | null = oldEndpoint) => {
      let pending: Promise<unknown> = Promise.resolve();
      const listener = listeners.get("pushsubscriptionchange");
      if (!listener) throw new Error("Missing rotation handler");
      listener({
        oldSubscription: endpoint ? { endpoint } : null,
        waitUntil: (work) => {
          pending = work;
        },
      });
      await pending;
    },
    fireSync: async (tag?: string) => {
      const listener = listeners.get("sync");
      if (!listener) throw new Error("Missing sync handler");
      let pending: Promise<unknown> = Promise.resolve();
      listener({
        tag:
          tag ??
          `sokosumi:push-renewal:${(await readRecord())?.generation ?? "revoked"}`,
        waitUntil: (work) => {
          pending = work;
        },
      });
      await pending;
    },
  };
}

function failStorage() {
  vi.spyOn(databaseFactory, "open").mockImplementation(() => {
    throw new Error("unavailable");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
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
    failStorage();
    await revokePushRenewal();
    expect(unregister).toHaveBeenCalledOnce();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    // Unsubscribe first: unregister deactivates the subscription, so an
    // unsubscribe after it answers false and reports nothing about the
    // subscription this teardown had to remove.
    expect(subscription.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      unregister.mock.invocationCallOrder[0],
    );
  });
  it("unregisters even when the unsubscribe fails", async () => {
    failStorage();
    subscription.unsubscribe.mockRejectedValueOnce(new Error("gone"));
    await revokePushRenewal();
    expect(unregister).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to stop browser push delivery",
      expect.objectContaining({
        message: "Could not stop browser push delivery",
      }),
    );
  });
  it("reports rather than throws when delivery cannot be stopped", async () => {
    failStorage();
    unregister.mockResolvedValueOnce(false);
    await expect(revokePushRenewal()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to stop browser push delivery",
      expect.objectContaining({
        message: "Could not stop browser push delivery",
      }),
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
  it("does not renew after permission is revoked", async () => {
    const instance = worker();
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
    expect(instance.requestLock).not.toHaveBeenCalled();
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
  it("retries a later rotation after an earlier endpoint update failed", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await instance.fire();
    subscription = makeSubscription("https://push.example/third");
    await instance.fire(newEndpoint);
    expect(instance.fetchMock).toHaveBeenCalledTimes(3);
    expect(await readRecord()).toMatchObject({
      endpoint: subscription.endpoint,
    });
  });
  it("reconciles a stale event with the current browser subscription", async () => {
    const instance = worker();
    await instance.fire("https://push.example/stale");
    expect(instance.fetchMock).toHaveBeenCalledOnce();
    expect(await readRecord()).toMatchObject({ endpoint: newEndpoint });
  });
  it("retains the old snapshot after transient retries are exhausted", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await instance.fire();
    expect(await readRecord()).toMatchObject({ endpoint: oldEndpoint });
  });
  it.each([408, 429, 500, 503])(
    "retries HTTP %s without another rotation",
    async (status) => {
      const instance = worker();
      instance.fetchMock.mockResolvedValueOnce({ ok: false, status });
      await instance.fire();
      expect(instance.fetchMock).toHaveBeenCalledTimes(2);
      expect(instance.requestLock).toHaveBeenCalledTimes(2);
      expect(instance.retryDelays).toEqual([1000]);
      expect(instance.syncRegister).not.toHaveBeenCalled();
      expect(await readRecord()).toMatchObject({ endpoint: newEndpoint });
    },
  );
  it("retries network failures with bounded waits then queues background sync", async () => {
    const instance = worker();
    instance.fetchMock.mockRejectedValue(new TypeError("network unavailable"));
    await instance.fire();
    expect(instance.fetchMock).toHaveBeenCalledTimes(3);
    expect(instance.retryDelays).toEqual([1000, 5000]);
    expect(instance.syncRegister).toHaveBeenCalledExactlyOnceWith(
      `sokosumi:push-renewal:${(await readRecord())?.generation}`,
    );
    instance.fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await instance.fireSync();
    expect(instance.fetchMock).toHaveBeenCalledTimes(4);
    expect(await readRecord()).toMatchObject({ endpoint: newEndpoint });
  });
  it("rejects a transiently failed sync so the browser keeps retrying", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(instance.fireSync()).rejects.toThrow("503");
    expect(instance.fetchMock).toHaveBeenCalledTimes(3);
    expect(instance.syncRegister).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404])(
    "does not retry permanent HTTP %s",
    async (status) => {
      const instance = worker();
      instance.fetchMock.mockResolvedValue({ ok: false, status });
      await instance.fire();
      expect(instance.fetchMock).toHaveBeenCalledTimes(1);
      expect(instance.syncRegister).not.toHaveBeenCalled();
      expect(instance.retryDelays).toEqual([]);
      await expect(instance.fireSync()).resolves.toBeUndefined();
      expect(instance.fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it("does not revive a revoked subscription during retry or a later sync", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    instance.delay.mockImplementationOnce(async () => {
      await revokePushRenewal();
    });
    await instance.fire();
    await instance.fireSync();
    expect(instance.fetchMock).toHaveBeenCalledTimes(1);
    expect(instance.syncRegister).not.toHaveBeenCalled();
    expect(await readRecord()).toBeUndefined();
  });
  it("does not adopt a new device generation during an old retry chain", async () => {
    const instance = worker();
    instance.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    instance.delay.mockImplementationOnce(async () => {
      await rememberPushRenewal(client, "reader", "current");
    });
    await instance.fire();
    expect(instance.fetchMock).toHaveBeenCalledTimes(1);
    expect(instance.syncRegister).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
  it("keeps bounded retry when Background Sync is unavailable", async () => {
    const instance = worker();
    runInContext("self.registration.sync = undefined", instance.context);
    instance.fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await instance.fire();
    expect(instance.fetchMock).toHaveBeenCalledTimes(3);
    expect(instance.syncRegister).not.toHaveBeenCalled();
  });
  it("ignores sync events owned by another feature", async () => {
    const instance = worker();
    await instance.fireSync("unrelated");
    expect(instance.fetchMock).not.toHaveBeenCalled();
  });

  it("does not apply an old account's queued sync to a new device generation", async () => {
    const instance = worker();
    const oldTag = `sokosumi:push-renewal:${(await readRecord())?.generation}`;
    await revokePushRenewal();
    await rememberPushRenewal(client, "reader", "current");
    await instance.fireSync(oldTag);
    expect(instance.fetchMock).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it.each(["NetworkError", "AbortError"])(
    "retries a transient subscribe %s",
    async (name) => {
      const instance = worker();
      instance.pushManager.getSubscription.mockResolvedValue(null);
      instance.pushManager.subscribe.mockRejectedValueOnce(
        new DOMException("push service unavailable", name),
      );
      await instance.fire();
      expect(instance.pushManager.subscribe).toHaveBeenCalledTimes(2);
      expect(instance.fetchMock).toHaveBeenCalledOnce();
      expect(await readRecord()).toMatchObject({ endpoint: newEndpoint });
    },
  );
  it("queues background sync when the push service remains unavailable", async () => {
    const instance = worker();
    instance.pushManager.getSubscription.mockResolvedValue(null);
    instance.pushManager.subscribe.mockRejectedValue(
      new DOMException("push service unavailable", "AbortError"),
    );
    await instance.fire();
    expect(instance.pushManager.subscribe).toHaveBeenCalledTimes(3);
    expect(instance.fetchMock).not.toHaveBeenCalled();
    expect(instance.syncRegister).toHaveBeenCalledOnce();
  });
  it("does not retry a subscribe permission error", async () => {
    const instance = worker();
    instance.pushManager.getSubscription.mockResolvedValue(null);
    instance.pushManager.subscribe.mockRejectedValue(
      new DOMException("permission denied", "NotAllowedError"),
    );
    await instance.fire();
    expect(instance.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(instance.syncRegister).not.toHaveBeenCalled();
  });

  it("retries an aborted subscription lookup", async () => {
    const instance = worker();
    instance.pushManager.getSubscription.mockRejectedValueOnce(
      new DOMException("lookup failed", "AbortError"),
    );
    await instance.fire();
    expect(instance.pushManager.getSubscription).toHaveBeenCalledTimes(2);
    expect(instance.fetchMock).toHaveBeenCalledOnce();
  });
});
