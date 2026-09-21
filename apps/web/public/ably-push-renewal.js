/** Worker-only renewal. Device credentials cannot publish or access another device. */
(() => {
  const DATABASE_NAME = "sokosumi.push.renewal";
  const STORE_NAME = "device";
  const RECORD_KEY = "current";
  const PUSH_WORK_LOCK = "sokosumi.push.work";
  const REQUEST_TIMEOUT_MS = 10_000;
  const RETRY_DELAYS_MS = [1_000, 5_000];
  const RENEWAL_SYNC_PREFIX = "sokosumi:push-renewal:";

  class RetryableRenewalError extends Error {
    constructor(message, generation) {
      super(message);
      this.generation = generation;
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Push renewal storage is blocked"));
    });
  }

  async function readSnapshot() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(STORE_NAME)
          .objectStore(STORE_NAME)
          .get(RECORD_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  async function updateEndpoint(snapshot, endpoint) {
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(RECORD_KEY);
        request.onsuccess = () => {
          if (request.result?.generation === snapshot.generation)
            store.put({ ...snapshot, endpoint }, RECORD_KEY);
        };
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function validSnapshot(value) {
    return (
      value &&
      [
        "generation",
        "userId",
        "deviceId",
        "deviceIdentityToken",
        "endpoint",
        "publicVapidKey",
      ].every((key) => typeof value[key] === "string" && value[key].length > 0)
    );
  }

  function decodeKey(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
  }

  function encodeKey(value) {
    if (!value) throw new Error("Missing push encryption key");
    return btoa(String.fromCharCode(...new Uint8Array(value)));
  }

  async function renew(generation) {
    const snapshot = await readSnapshot();
    if (!validSnapshot(snapshot) || snapshot.generation !== generation) return;
    const options = {
      userVisibleOnly: true,
      applicationServerKey: decodeKey(snapshot.publicVapidKey),
    };
    if (
      (await self.registration.pushManager.permissionState(options)) !==
      "granted"
    )
      return;
    // Read the live subscription under the lock, since an event may have waited
    // behind a foreground repair and its supplied replacement may now be stale.
    let subscription;
    try {
      subscription = await self.registration.pushManager.getSubscription();
      if (!subscription)
        subscription = await self.registration.pushManager.subscribe(options);
    } catch (error) {
      if (error?.name === "NetworkError" || error?.name === "AbortError")
        throw new RetryableRenewalError(
          "Push service subscription failed",
          generation,
        );
      throw error;
    }
    const current = await readSnapshot();
    if (current?.generation !== snapshot.generation) {
      await subscription.unsubscribe();
      return;
    }
    const response = await fetch(
      `https://rest.ably.io/push/deviceRegistrations/${encodeURIComponent(snapshot.deviceId)}`,
      {
        method: "PATCH",
        credentials: "omit",
        headers: {
          Authorization: `Bearer ${btoa(snapshot.deviceIdentityToken)}`,
          "Content-Type": "application/json",
          "X-Ably-Version": "2",
        },
        body: JSON.stringify({
          push: {
            recipient: {
              transportType: "web",
              targetUrl: btoa(subscription.endpoint),
              publicVapidKey: snapshot.publicVapidKey,
              encryptionKey: {
                p256dh: encodeKey(subscription.getKey("p256dh")),
                auth: encodeKey(subscription.getKey("auth")),
              },
            },
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    ).catch(() => {
      throw new RetryableRenewalError(
        "Push renewal network request failed",
        generation,
      );
    });
    if (!response.ok) {
      const message = `Push renewal failed (${response.status})`;
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      )
        throw new RetryableRenewalError(message, generation);
      throw new Error(message);
    }
    if ((await readSnapshot())?.generation !== snapshot.generation) {
      await subscription.unsubscribe();
      return;
    }
    await updateEndpoint(snapshot, subscription.endpoint);
  }

  async function renewWithRetries(expectedGeneration) {
    const snapshot = await readSnapshot();
    if (
      !validSnapshot(snapshot) ||
      (expectedGeneration && snapshot.generation !== expectedGeneration)
    )
      return;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await self.navigator.locks.request(PUSH_WORK_LOCK, () =>
          renew(snapshot.generation),
        );
        return;
      } catch (error) {
        if (!(error instanceof RetryableRenewalError)) throw error;
        if ((await readSnapshot())?.generation !== snapshot.generation) return;
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        // Release the lock before waiting so logout and foreground repair can run.
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
        );
      }
    }
  }

  function canRenew() {
    return self.navigator.locks && typeof indexedDB !== "undefined";
  }

  self.addEventListener("pushsubscriptionchange", (event) => {
    if (!canRenew()) return;
    event.waitUntil(
      renewWithRetries().catch(async (error) => {
        console.error("Could not renew push subscription", error);
        if (error instanceof RetryableRenewalError && self.registration.sync) {
          try {
            await self.registration.sync.register(
              RENEWAL_SYNC_PREFIX + error.generation,
            );
          } catch (syncError) {
            console.error("Could not schedule push renewal", syncError);
          }
        }
      }),
    );
  });

  self.addEventListener("sync", (event) => {
    if (!event.tag.startsWith(RENEWAL_SYNC_PREFIX) || !canRenew()) return;
    const generation = event.tag.slice(RENEWAL_SYNC_PREFIX.length);
    if (!generation) return;
    event.waitUntil(
      renewWithRetries(generation).catch((error) => {
        console.error("Could not sync push subscription", error);
        // Reject transient failures: resolving would tell the browser to discard
        // its queued sync. Permanent errors require foreground registration repair.
        if (error instanceof RetryableRenewalError) throw error;
      }),
    );
  });
})();
