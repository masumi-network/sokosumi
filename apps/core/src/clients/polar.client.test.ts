import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPolarCheckout,
  listPolarProducts,
  revokePolarSubscription,
  verifyPolarWebhook,
} from "./polar.client";

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

describe("createPolarCheckout", () => {
  const input = {
    productIds: ["prod_1", "prod_2"],
    organizationId: "org_1",
    metadata: { projectId: "project_1" },
    returnUrl: "https://cmo.xyz/?project=project_1",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 503 without configuration", async () => {
    m.polar = { POLAR_ACCESS_TOKEN: undefined };

    await expect(createPolarCheckout(input)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("asks Polar for a checkout of the products, trial and discount codes off, and returns its URL", async () => {
    const fetchMock = vi.fn(async (..._request: Parameters<typeof fetch>) =>
      Response.json({ url: "https://polar.example/checkout/1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await createPolarCheckout(input);

    expect(url).toBe("https://polar.example/checkout/1");
    const [request, init] = fetchMock.mock.calls[0] ?? [];
    const sent =
      request instanceof Request ? request : new Request(request!, init);
    expect(sent.method).toBe("POST");
    expect(new URL(sent.url).pathname).toBe("/v1/checkouts/");
    await expect(sent.json()).resolves.toEqual({
      products: ["prod_1", "prod_2"],
      external_customer_id: "org_1",
      metadata: { projectId: "project_1" },
      success_url: "https://cmo.xyz/?project=project_1",
      return_url: "https://cmo.xyz/?project=project_1",
      allow_discount_codes: false,
      allow_trial: false,
    });
  });
});

describe("revokePolarSubscription", () => {
  /** Polar's answer to the one request the SDK sends; nothing leaves the test. */
  function polarAnswers(status: number, body: unknown) {
    const fetchMock = vi.fn(
      async (..._request: Parameters<typeof fetch>) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Polar to revoke that subscription", async () => {
    const fetchMock = polarAnswers(200, {});

    await revokePolarSubscription("sub_1").catch(() => undefined);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    const request = input instanceof Request ? input : null;
    expect(request?.url ?? String(input)).toContain("/v1/subscriptions/sub_1");
    expect(request?.method ?? init?.method).toBe("DELETE");
  });

  it("counts a subscription Polar already ended as done", async () => {
    polarAnswers(403, {
      error: "AlreadyCanceledSubscription",
      detail:
        "This subscription is already canceled or will be at the end of the period.",
    });

    await expect(revokePolarSubscription("sub_1")).resolves.toBeUndefined();
  });

  it("fails when Polar fails", async () => {
    polarAnswers(500, { error: "InternalServerError", detail: "boom" });

    await expect(revokePolarSubscription("sub_1")).rejects.toThrow();
  });

  it("answers 503 without configuration", async () => {
    m.polar = { POLAR_ACCESS_TOKEN: undefined };

    await expect(revokePolarSubscription("sub_1")).rejects.toMatchObject({
      status: 503,
    });
  });
});
