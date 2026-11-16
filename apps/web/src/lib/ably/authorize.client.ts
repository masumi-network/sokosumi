import type * as Ably from "ably";

const pendingAuthorize = new WeakMap<
  Ably.Realtime,
  Promise<Ably.TokenDetails>
>();

/**
 * `ably.auth.authorize()`, once for every caller in the same tick.
 *
 * Opening a chat room mounts the message and typing subscribers in one
 * commit. Each asked for its own token, so one room open cost two mints at
 * Core and two at Ably. The request starts a microtask later, after every
 * effect of the commit has registered its room scope, so the one token names
 * all of them. A caller that arrives after the request started gets its own.
 */
export function authorizeAbly(ably: Ably.Realtime): Promise<Ably.TokenDetails> {
  const pending = pendingAuthorize.get(ably);
  if (pending) return pending;
  const request = Promise.resolve().then(() => {
    pendingAuthorize.delete(ably);
    return ably.auth.authorize();
  });
  pendingAuthorize.set(ably, request);
  return request;
}
