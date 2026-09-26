import { afterEach, describe, expect, it, vi } from "vitest";

import { createPaymentClient } from "./masumi-payment.client.js";
import { createRegistryClient } from "./masumi-registry.client.js";

const LONG_KEY = "ABCDEFGHIJKLMNOPabcdefghijklmnop0123456789ABCDEF";
const SHORT_KEY = "aB3dE6gH9jK2mN5";
const ESCAPED_KEY = 'key-with-"quotes"-and-\\slashes';

const cases = [
  {
    name: "a key crossing the cap",
    key: LONG_KEY,
    body: { error: { message: "x".repeat(223) + LONG_KEY + "z".repeat(100) } },
  },
  {
    name: "a short key in JSON",
    key: SHORT_KEY,
    body: { headers: { token: SHORT_KEY } },
  },
  {
    name: "a short key in an envelope",
    key: SHORT_KEY,
    body: { error: { message: `rejected ${SHORT_KEY}` } },
  },
  {
    name: "an escaped key in JSON",
    key: ESCAPED_KEY,
    body: { headers: { token: ESCAPED_KEY } },
  },
  {
    name: "a key in a capped JSON dump",
    key: LONG_KEY,
    body: { padding: "x".repeat(214), token: LONG_KEY, tail: "x".repeat(300) },
  },
];

afterEach(() => vi.restoreAllMocks());

for (const clientType of ["registry", "payment"] as const) {
  describe(`${clientType} error credential redaction`, () => {
    it.each(cases)("redacts $name before extraction", async ({ key, body }) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 502,
          headers: { "content-type": "application/json" },
        }),
      );
      const result =
        clientType === "registry"
          ? await createRegistryClient(
              "Preprod",
              "https://registry.example.com",
              key,
            ).getAgentsDiff(new Date("2026-01-01"), null)
          : await createPaymentClient(
              "Preprod",
              "https://payment.example.com",
              key,
            ).getPurchaseByBlockchainIdentifier("purchase-id");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result.isErr()).toBe(true);
      const message = result._unsafeUnwrapErr();
      expect(message).not.toContain(key.slice(0, 16));
      expect(message).not.toContain(JSON.stringify(key).slice(1, -1));
      expect(message).toContain("[redacted:api-key]");
      expect(message.length).toBeLessThanOrEqual(300);
    });
  });
}
