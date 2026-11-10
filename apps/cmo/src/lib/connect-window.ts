/**
 * Connect in a small window: Launch opens the network's sign-in in a popup,
 * and the page the connection ends on tells Launch, which polls at once.
 * Both sides only talk to their own origin.
 */

export type ConnectResult = "connected" | "failed" | "none";

const RESULTS: readonly ConnectResult[] = ["connected", "failed", "none"];
const MESSAGE = "cmo-connect-done";

/** Where a connect window ends: the page that tells Launch and closes. */
export function connectDonePath(result: ConnectResult): string {
  return `/connect/done?result=${result}`;
}

/** A result from the address or a message; anything unknown failed. */
export function readConnectResult(value: unknown): ConnectResult {
  return RESULTS.find((result) => result === value) ?? "failed";
}

function isDone(data: unknown): data is { type: string; result: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === MESSAGE &&
    "result" in data &&
    RESULTS.some((result) => result === data.result)
  );
}

/**
 * Tells the page that opened this window, on CMO's own origin only. A
 * provider's sign-in can cut a popup from its opener
 * (Cross-Origin-Opener-Policy); then a same-origin channel carries it.
 * Returns whether there was an opener to tell.
 */
export function tellOpener(result: ConnectResult): boolean {
  const message = { type: MESSAGE, result };
  const opener: Window | null = window.opener;
  if (opener) {
    opener.postMessage(message, window.location.origin);
    return true;
  }
  if (typeof BroadcastChannel === "function") {
    const channel = new BroadcastChannel(MESSAGE);
    channel.postMessage(message);
    channel.close();
  }
  return false;
}

/** Calls `onDone` when a connect window of this origin finishes. */
export function listenForConnectDone(
  onDone: (result: ConnectResult) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || !isDone(event.data)) return;
    onDone(readConnectResult(event.data.result));
  };
  window.addEventListener("message", onMessage);
  const channel =
    typeof BroadcastChannel === "function"
      ? new BroadcastChannel(MESSAGE)
      : null;
  if (channel) {
    // Same origin by definition.
    channel.onmessage = (event: MessageEvent) => {
      if (isDone(event.data)) onDone(readConnectResult(event.data.result));
    };
  }
  return () => {
    window.removeEventListener("message", onMessage);
    channel?.close();
  };
}

/**
 * Opens the connect window empty, in the click itself so a popup blocker lets
 * it through; the caller sends it to the network once it has the URL. Null
 * when the browser blocked it.
 */
export function openConnectWindow(): Window | null {
  return window.open("", "cmo-connect", "popup,width=520,height=720");
}
