/**
 * The Expo push service, which is what the native clients register against.
 *
 * Expo rather than APNs and FCM directly, because the alternative is holding an
 * Apple signing key and a Google service account in Core and reimplementing two
 * transports to say the same sentence. Expo tokens are self-authenticating, so
 * this needs no credential to work at all; `EXPO_ACCESS_TOKEN` is optional and
 * only tightens who may send to them.
 */

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Expo accepts at most 100 messages per request. */
export const EXPO_BATCH_SIZE = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  badge?: number;
}

/**
 * What happened to one message, in the order they were sent.
 *
 * `DeviceNotRegistered` is the one worth acting on: it means the install is
 * gone for good, and the row should be deleted rather than retried forever.
 */
export interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(items.slice(at, at + size));
  }
  return out;
}

/**
 * Sends a batch and returns one ticket per message, positionally.
 *
 * Throws only when the request itself failed — a per-message rejection comes
 * back as an error ticket, because one dead token must not stop the other
 * ninety-nine notifications going out.
 */
export async function sendExpoPush(
  messages: readonly ExpoPushMessage[],
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = [];

  for (const batch of chunk(messages, EXPO_BATCH_SIZE)) {
    const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(`Expo push request failed (${response.status})`);
    }

    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    const batchTickets = payload.data ?? [];

    // Positional correspondence is the whole contract here — a short response
    // would silently shift every ticket onto the wrong token, and reaping by a
    // shifted index would delete live devices.
    if (batchTickets.length !== batch.length) {
      throw new Error(
        `Expo returned ${batchTickets.length} tickets for ${batch.length} messages`,
      );
    }

    tickets.push(...batchTickets);
  }

  return tickets;
}

/** The tokens Expo says are gone, given the messages that were sent. */
export function deadTokens(
  messages: readonly ExpoPushMessage[],
  tickets: readonly ExpoPushTicket[],
): string[] {
  return messages
    .filter(
      (_, index) =>
        tickets[index]?.status === "error" &&
        tickets[index]?.details?.error === DEVICE_NOT_REGISTERED,
    )
    .map((message) => message.to);
}
