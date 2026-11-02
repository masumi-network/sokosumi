import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CloudflareApiError,
  cloudflareDnsClient,
} from "./cloudflare-dns.client";

const TOKEN = "cf-secret-token-0123456789abcdef";
const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cloudflareDnsClient", () => {
  it("lists active zones by name with the bearer token", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        success: true,
        result: [{ id: "zone_1", name: "brand.example", extra: true }],
      }),
    );

    await expect(
      cloudflareDnsClient(TOKEN).listZones("brand.example"),
    ).resolves.toEqual([{ id: "zone_1", name: "brand.example" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/zones?name=brand.example&status=active",
    );
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("creates records unproxied only where proxying applies", async () => {
    fetchMock.mockImplementation(async () =>
      reply(200, { success: true, result: {} }),
    );
    const client = cloudflareDnsClient(TOKEN);

    await expect(
      client.createDnsRecord("zone_1", {
        type: "MX",
        name: "send.brand.example",
        content: "feedback.example",
        priority: 10,
      }),
    ).resolves.toBe(true);
    await client.createDnsRecord("zone_1", {
      type: "CNAME",
      name: "resend._domainkey.brand.example",
      content: "dkim.example",
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      type: "MX",
      name: "send.brand.example",
      content: "feedback.example",
      priority: 10,
      ttl: 1,
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: "CNAME",
      proxied: false,
    });
  });

  it("treats an identical existing record as done", async () => {
    fetchMock.mockResolvedValue(
      reply(400, {
        success: false,
        errors: [{ code: 81058, message: "identical record exists" }],
      }),
    );
    await expect(
      cloudflareDnsClient(TOKEN).createDnsRecord("zone_1", {
        type: "TXT",
        name: "send.brand.example",
        content: "v=spf1",
      }),
    ).resolves.toBe(false);
  });

  it("never puts the token into an error", async () => {
    fetchMock.mockResolvedValue(
      reply(403, {
        success: false,
        errors: [{ code: 10000, message: `Authentication error ${TOKEN}` }],
      }),
    );

    const error = await cloudflareDnsClient(TOKEN)
      .listZones("brand.example")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CloudflareApiError);
    expect(error).toMatchObject({ status: 403, codes: [10000] });
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(TOKEN);
    expect((error as Error).stack).not.toContain(TOKEN);
  });
});
