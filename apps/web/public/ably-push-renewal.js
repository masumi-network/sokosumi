/** Worker-only renewal. Device credentials cannot publish or access another device. */
(() => {
  const DATABASE_NAME = "sokosumi.push.renewal";
  const STORE_NAME = "device";
  const RECORD_KEY = "current";
  const PUSH_WORK_LOCK = "sokosumi.push.work";
  const REQUEST_TIMEOUT_MS = 10_000;

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

  async function renew() {
    const snapshot = await readSnapshot();
    if (!validSnapshot(snapshot)) return;
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
    let subscription = await self.registration.pushManager.getSubscription();
    if (!subscription)
      subscription = await self.registration.pushManager.subscribe(options);
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
    );
    if (!response.ok)
      throw new Error(`Push renewal failed (${response.status})`);
    if ((await readSnapshot())?.generation !== snapshot.generation) {
      await subscription.unsubscribe();
      return;
    }
    await updateEndpoint(snapshot, subscription.endpoint);
  }

  self.addEventListener("pushsubscriptionchange", (event) => {
    // Foreground recovery remains available when cross-context locking is absent.
    if (!self.navigator.locks || typeof indexedDB === "undefined") return;
    event.waitUntil(
      self.navigator.locks
        .request(PUSH_WORK_LOCK, renew)
        .catch((error) =>
          console.error("Could not renew push subscription", error),
        ),
    );
  });
})();
