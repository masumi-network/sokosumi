import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getOrCreateAblyClientInstanceId } from "./ably-client-instance-id";
import { wantsPushHere } from "./push-preference.client";
import { healPushSubscription } from "./push-self-heal.client";
import {
  getPushTeardownVersion,
  queuePushWork,
} from "./push-work-queue.client";
import { readPushDeviceOwner } from "./release-push-device.client";

const fetchMock = vi.fn();
const unsubscribe = vi.fn();
const unregister = vi.fn();
const initialLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
let subscription: { endpoint: string; unsubscribe: typeof unsubscribe } | null;

async function renewalSnapshot(
  write?: boolean,
  userId = "alice",
): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("sokosumi.push.renewal", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("device");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(
        "device",
        write ? "readwrite" : "readonly",
      );
      const store = transaction.objectStore("device");
      if (write)
        store.put({ userId, generation: `${userId}-generation` }, "current");
      const request = store.get("current");
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function tokenFor(userId: string): Response {
  return Response.json({
    token: "local-test-token",
    clientId: `${userId}:${getOrCreateAblyClientInstanceId()}`,
    issued: Date.now(),
    expires: Date.now() + 60_000,
  });
}

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "Notification",
    Object.assign(function Notification() {}, {
      permission: "granted",
      requestPermission: async () => "granted",
    }),
  );
  vi.stubGlobal("PushManager", function PushManager() {});
  unsubscribe.mockReset().mockImplementation(async () => {
    subscription = null;
    return true;
  });
  unregister.mockReset().mockResolvedValue(true);
  subscription = { endpoint: "alice-endpoint", unsubscribe };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => subscription },
        unregister,
      }),
    },
  });
  localStorage.setItem("sokosumi.push.deviceOwner", "alice");
  localStorage.setItem(
    "ably.push.deviceIdentityToken",
    JSON.stringify({ value: "alice-token" }),
  );
  localStorage.setItem(
    "sokosumi.push.preference",
    JSON.stringify({ userId: "alice", suspended: false }),
  );
  fetchMock.mockReset().mockImplementation(async () => tokenFor("bob"));
  await renewalSnapshot(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (initialLocks) Object.defineProperty(navigator, "locks", initialLocks);
  else Reflect.deleteProperty(navigator, "locks");
});

it("stops the former account's push and renewal without opting in the new account", async () => {
  await expect(healPushSubscription("bob")).resolves.toBe(false);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(subscription).toBeNull();
  expect(await renewalSnapshot()).toBeUndefined();
  expect(wantsPushHere("bob")).toBe(false);
});

it("stops a prior account's push when only its saved preference identifies the owner", async () => {
  localStorage.removeItem("sokosumi.push.deviceOwner");

  await expect(healPushSubscription("bob")).resolves.toBe(false);

  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(subscription).toBeNull();
  expect(await renewalSnapshot()).toBeUndefined();
  expect(wantsPushHere("bob")).toBe(false);
});

it("does not let a stale tab stop the current account's push", async () => {
  await expect(healPushSubscription("carol")).resolves.toBe(false);
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(subscription).not.toBeNull();
  expect(await renewalSnapshot()).toMatchObject({ userId: "alice" });
});

it("unregisters the old worker if its renewal credentials cannot be revoked", async () => {
  vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
    throw new Error("Renewal storage is blocked");
  });

  await expect(healPushSubscription("bob")).resolves.toBe(false);

  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledOnce();
});

it("does not unsubscribe a replacement made while its account check was pending", async () => {
  let finishCheck: (value: Response) => void = () => {};
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishCheck = resolve;
      }),
  );
  const recovery = healPushSubscription("bob");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  await queuePushWork(async () =>
    localStorage.setItem("sokosumi.push.deviceOwner", "bob"),
  );
  finishCheck(tokenFor("bob"));
  await recovery;
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(readPushDeviceOwner()).toBe("bob");
});

it("revokes renewal and fences an older repair before waiting for the push queue", async () => {
  let finishRepair: () => void = () => {};
  const previousVersion = getPushTeardownVersion();
  let repairStillWanted = true;
  const previousRepair = queuePushWork(async () => {
    await new Promise<void>((resolve) => {
      finishRepair = resolve;
    });
    repairStillWanted = previousVersion === getPushTeardownVersion();
  });
  const recovery = healPushSubscription("bob");
  await vi.waitFor(async () => expect(await renewalSnapshot()).toBeUndefined());
  expect(unsubscribe).not.toHaveBeenCalled();
  finishRepair();
  await Promise.all([previousRepair, recovery]);
  expect(repairStillWanted).toBe(false);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("preserves a replacement renewal while the old account's storage revoke is pending", async () => {
  const open = indexedDB.open.bind(indexedDB);
  let finishRevoke: (() => void) | undefined;
  vi.spyOn(indexedDB, "open").mockImplementationOnce((name, version) => {
    const request = open(name, version);
    let onSuccess: typeof request.onsuccess = null;
    Object.defineProperty(request, "onsuccess", {
      get: () => null,
      set: (callback: typeof request.onsuccess) => {
        onSuccess = callback;
      },
    });
    request.addEventListener("success", (event) => {
      finishRevoke = () => onSuccess?.call(request, event);
    });
    return request;
  });
  let finishQueuedWork: (() => Promise<void>) | undefined;
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, work: () => Promise<void>) =>
        new Promise<void>((resolve, reject) => {
          finishQueuedWork = async () => {
            await work().then(resolve, reject);
          };
        }),
    },
  });

  const recovery = healPushSubscription("bob");
  await vi.waitFor(() => {
    expect(finishRevoke).toBeTypeOf("function");
    expect(finishQueuedWork).toBeTypeOf("function");
  });
  // A second tab finishes its deliberate replacement before this tab gets the lock.
  localStorage.setItem("sokosumi.push.deviceOwner", "bob");
  await renewalSnapshot(true, "bob");
  finishRevoke?.();
  await finishQueuedWork?.();
  await recovery;

  expect(unsubscribe).not.toHaveBeenCalled();
  expect(await renewalSnapshot()).toMatchObject({ userId: "bob" });
});
