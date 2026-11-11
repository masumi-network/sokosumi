import { createHash, randomBytes } from "node:crypto";
import { makeAuthEvent } from "nostr-tools/nip42";
import {
  type Event,
  type EventTemplate,
  finalizeEvent,
} from "nostr-tools/pure";

/**
 * A minimal client for one Buzz relay (a NIP-29 Nostr relay).
 *
 * Writes go over HTTP (`POST /events`, NIP-98 signed by the author), so a
 * write needs no open socket and works from a serverless function. Reads that
 * must stay live use a WebSocket with NIP-42 AUTH; see {@link subscribe}.
 */

export type NostrFilter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
};

export class BuzzRelayRejectedError extends Error {
  constructor(
    readonly kind: number,
    readonly reason: string,
  ) {
    super(`Buzz relay refused kind ${kind}: ${reason}`);
  }
}

/** `ws://host:port` → `http://host:port`, `wss://` → `https://`. */
export function relayHttpOrigin(relayUrl: string): string {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  return url.origin;
}

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** NIP-98 `Authorization` header for one request, bound to its exact body. */
export function nip98Header(input: {
  secretKey: Uint8Array;
  url: string;
  method: string;
  body?: string;
}): string {
  const tags = [
    ["u", input.url],
    ["method", input.method.toUpperCase()],
    // The relay refuses a proof it has seen; two identical requests in one
    // second would otherwise sign to the same event.
    ["nonce", randomBytes(16).toString("hex")],
  ];
  if (input.body !== undefined) tags.push(["payload", sha256Hex(input.body)]);
  const proof = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    input.secretKey,
  );
  return `Nostr ${Buffer.from(JSON.stringify(proof), "utf8").toString("base64")}`;
}

/** Signs a template as the given key; the id is known before it is sent. */
export function signEvent(
  template: Omit<EventTemplate, "created_at"> & { created_at?: number },
  secretKey: Uint8Array,
): Event {
  return finalizeEvent(
    {
      ...template,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    },
    secretKey,
  );
}

/**
 * Sends one signed event. Resolves on acceptance (a duplicate counts: the
 * relay already has it), throws {@link BuzzRelayRejectedError} on refusal.
 */
export async function publishSignedEvent(input: {
  relayUrl: string;
  event: Event;
  secretKey: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<{ eventId: string; message: string | null }> {
  const url = `${relayHttpOrigin(input.relayUrl)}/events`;
  const body = JSON.stringify(input.event);
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: nip98Header({
        secretKey: input.secretKey,
        url,
        method: "POST",
        body,
      }),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { message: text };
  }
  const message =
    typeof json.message === "string"
      ? json.message
      : typeof json.error === "string"
        ? json.error
        : null;
  if (
    response.ok &&
    (json.accepted === true || message?.startsWith("duplicate"))
  ) {
    return { eventId: input.event.id, message };
  }
  if (message?.startsWith("duplicate")) {
    return { eventId: input.event.id, message };
  }
  throw new BuzzRelayRejectedError(
    input.event.kind,
    message ?? `HTTP ${response.status}`,
  );
}

/** One-shot history read over HTTP (`POST /query`). */
export async function queryEvents(input: {
  relayUrl: string;
  secretKey: Uint8Array;
  filters: NostrFilter[];
  fetchImpl?: typeof fetch;
}): Promise<Event[]> {
  const url = `${relayHttpOrigin(input.relayUrl)}/query`;
  const body = JSON.stringify(input.filters);
  const response = await (input.fetchImpl ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: nip98Header({
        secretKey: input.secretKey,
        url,
        method: "POST",
        body,
      }),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Buzz query failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  const json = (await response.json()) as unknown;
  if (Array.isArray(json)) return json as Event[];
  const events = (json as { events?: unknown }).events;
  return Array.isArray(events) ? (events as Event[]) : [];
}

export interface RelaySubscription {
  close(): void;
  /** Resolves once AUTH is accepted and the REQ is sent. */
  ready: Promise<void>;
}

/**
 * A live subscription as one key. Answers the relay's NIP-42 challenge, then
 * sends the REQ, and hands every event to `onEvent` (stored history first,
 * then live). The caller owns reconnecting: `onClose` fires once.
 */
export function subscribe(input: {
  relayUrl: string;
  secretKey: Uint8Array;
  filters: NostrFilter[];
  onEvent: (event: Event) => void;
  onEose?: () => void;
  onClose?: (reason: string) => void;
  WebSocketImpl?: typeof WebSocket;
}): RelaySubscription {
  const Socket = input.WebSocketImpl ?? WebSocket;
  const socket = new Socket(input.relayUrl);
  const subscriptionId = `sokosumi-${Math.random().toString(36).slice(2, 10)}`;
  let authEventId: string | null = null;
  let closed = false;
  let resolveReady: () => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});

  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    rejectReady(new Error(reason));
    input.onClose?.(reason);
  };

  socket.addEventListener("message", (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(String(raw.data));
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;
    const [type, ...rest] = message as [string, ...unknown[]];
    if (type === "AUTH" && typeof rest[0] === "string") {
      const auth = finalizeEvent(
        makeAuthEvent(input.relayUrl, rest[0]),
        input.secretKey,
      );
      authEventId = auth.id;
      socket.send(JSON.stringify(["AUTH", auth]));
      return;
    }
    if (type === "OK" && rest[0] === authEventId) {
      if (rest[1] !== true) {
        finish(`auth refused: ${String(rest[2] ?? "")}`);
        socket.close();
        return;
      }
      socket.send(JSON.stringify(["REQ", subscriptionId, ...input.filters]));
      resolveReady();
      return;
    }
    if (type === "EVENT" && rest[0] === subscriptionId && rest[1]) {
      input.onEvent(rest[1] as Event);
      return;
    }
    if (type === "EOSE" && rest[0] === subscriptionId) {
      input.onEose?.();
      return;
    }
    if (type === "CLOSED" && rest[0] === subscriptionId) {
      finish(`subscription closed: ${String(rest[1] ?? "")}`);
      socket.close();
    }
  });
  socket.addEventListener("close", () => finish("socket closed"));
  socket.addEventListener("error", () => finish("socket error"));

  return {
    ready,
    close() {
      if (!closed && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(["CLOSE", subscriptionId]));
      }
      closed = true;
      socket.close();
    },
  };
}
