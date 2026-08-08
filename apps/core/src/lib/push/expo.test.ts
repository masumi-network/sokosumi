import { describe, expect, it, vi } from "vitest";

import {
  deadTokens,
  type ExpoPushMessage,
  type ExpoPushTicket,
  sendExpoPush,
} from "./expo";

function message(to: string): ExpoPushMessage {
  return { to, title: "Title", body: "Body" };
}

function respondWith(tickets: ExpoPushTicket[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: tickets }),
  } as unknown as Response);
}

describe("sendExpoPush", () => {
  it("posts the batch and returns a ticket per message", async () => {
    const fetchImpl = respondWith([{ status: "ok" }, { status: "ok" }]);

    const tickets = await sendExpoPush(
      [message("a"), message("b")],
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    expect(tickets).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends no authorization header when there is no access token", async () => {
    // Expo tokens are self-authenticating; the header is optional hardening.
    const fetchImpl = respondWith([{ status: "ok" }]);

    await sendExpoPush(
      [message("a")],
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      undefined,
    );
  });

  it("sends the access token when it is configured", async () => {
    const fetchImpl = respondWith([{ status: "ok" }]);

    await sendExpoPush(
      [message("a")],
      "secret",
      fetchImpl as unknown as typeof fetch,
    );

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer secret",
    );
  });

  it("splits into batches of a hundred", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(
        (init as RequestInit).body as string,
      ) as unknown[];
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: body.map(() => ({ status: "ok" })) }),
      } as unknown as Response;
    });

    const messages = Array.from({ length: 250 }, (_, i) => message(`t${i}`));
    const tickets = await sendExpoPush(
      messages,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(tickets).toHaveLength(250);
  });

  it("throws when the request itself fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    await expect(
      sendExpoPush(
        [message("a")],
        undefined,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("503");
  });

  it("refuses a short response rather than misaligning the tickets", async () => {
    // Positional correspondence is the whole contract: a short response would
    // shift every ticket onto the wrong token, and reaping by a shifted index
    // deletes live devices.
    const fetchImpl = respondWith([{ status: "ok" }]);

    await expect(
      sendExpoPush(
        [message("a"), message("b")],
        undefined,
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/1 tickets for 2 messages/);
  });
});

describe("deadTokens", () => {
  it("picks out only the installs that are gone", () => {
    const messages = [message("live"), message("gone"), message("other-error")];
    const tickets: ExpoPushTicket[] = [
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "MessageTooBig" } },
    ];

    expect(deadTokens(messages, tickets)).toEqual(["gone"]);
  });

  it("keeps a token whose send merely failed", () => {
    // A transient failure is not a reason to forget where someone lives.
    const messages = [message("a")];
    const tickets: ExpoPushTicket[] = [
      { status: "error", details: { error: "MessageRateExceeded" } },
    ];

    expect(deadTokens(messages, tickets)).toEqual([]);
  });

  it("finds nothing when everything went out", () => {
    expect(deadTokens([message("a")], [{ status: "ok" }])).toEqual([]);
  });
});
