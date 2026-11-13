import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listPolarProducts, verifyPolarWebhook } from "./polar.client";

const m = vi.hoisted(() => ({
  polar: {} as Record<string, string | undefined>,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, getEnv: () => ({ ...actual.getEnv(), ...m.polar }) };
});

const SECRET = process.env.POLAR_WEBHOOK_SECRET!;

function sign(body: string, secret = SECRET): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac(
    "sha256",
    Buffer.from(secret.slice("whsec_".length), "base64"),
  )
    .update(`msg_1.${timestamp}.${body}`)
    .digest("base64");
  return {
    "webhook-id": "msg_1",
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}

beforeEach(() => {
  m.polar = {};
});

describe("verifyPolarWebhook", () => {
  const body = JSON.stringify({ type: "order.paid", data: { id: "order_1" } });

  it("returns the event of a body signed with the webhook secret", async () => {
    const result = await verifyPolarWebhook(body, sign(body));

    expect(result._unsafeUnwrap()).toEqual({
      type: "order.paid",
      data: { id: "order_1" },
    });
  });

  it("refuses a body that was changed after signing", async () => {
    const result = await verifyPolarWebhook(`${body} `, sign(body));

    expect(result._unsafeUnwrapErr()).toBe("invalid_signature");
  });

  it("refuses a body signed with another secret", async () => {
    const result = await verifyPolarWebhook(
      body,
      sign(body, "whsec_YW5vdGhlci1zZWNyZXQ="),
    );

    expect(result._unsafeUnwrapErr()).toBe("invalid_signature");
  });

  it("reports a signed event type this API version does not know", async () => {
    const unknown = JSON.stringify({ type: "future.event", data: {} });

    const result = await verifyPolarWebhook(unknown, sign(unknown));

    expect(result._unsafeUnwrapErr()).toBe("unsupported_event");
  });

  it.each(["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ENVIRONMENT"])(
    "is not configured without %s",
    async (key) => {
      m.polar = { [key]: undefined };

      const result = await verifyPolarWebhook(body, sign(body));

      expect(result._unsafeUnwrapErr()).toBe("not_configured");
    },
  );
});

describe("listPolarProducts", () => {
  it("answers 503 without configuration", async () => {
    m.polar = { POLAR_ACCESS_TOKEN: undefined };

    await expect(listPolarProducts()).rejects.toMatchObject({ status: 503 });
  });
});
