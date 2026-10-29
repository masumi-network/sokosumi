import { createVerify, generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDomainConnectApplyUrl,
  discoverDomainConnectProvider,
  domainConnectTemplateInput,
} from "./domain-connect";
import type { NewsletterDnsRecord } from "./sending-domain";

const m = vi.hoisted(() => ({
  resolveTxt: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({
  Resolver: function Resolver() {
    return { resolveTxt: m.resolveTxt };
  },
}));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: m.fetch }));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function record(
  overrides: Partial<NewsletterDnsRecord> & Pick<NewsletterDnsRecord, "name">,
): NewsletterDnsRecord {
  return {
    record: "SPF",
    type: "TXT",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: "Auto",
    priority: null,
    status: "pending",
    ...overrides,
  };
}

const RECORDS = [
  record({
    record: "DKIM",
    name: "resend._domainkey.news.brand.example",
    value: "p=MIGfKEY+/=",
  }),
  record({
    type: "MX",
    name: "send.news.brand.example",
    value: "feedback-smtp.us-east-1.amazonses.com",
    priority: 10,
  }),
  record({ name: "send.news.brand.example" }),
];

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

const DMARC = record({
  record: "DMARC",
  name: "_dmarc.news.brand.example",
  value: "v=DMARC1; p=none;",
  status: "not_found",
});

describe("domainConnectTemplateInput", () => {
  it("fills the template from Resend's records", () => {
    expect(domainConnectTemplateInput("news.brand.example", RECORDS)).toEqual({
      variables: {
        dkimkey: "p=MIGfKEY+/=",
        mxhost: "feedback-smtp.us-east-1.amazonses.com",
      },
      groupIds: ["mail"],
    });
  });

  it("adds the DMARC group only while the policy is missing", () => {
    expect(
      domainConnectTemplateInput("news.brand.example", [...RECORDS, DMARC])
        ?.groupIds,
    ).toEqual(["mail", "dmarc"]);
    expect(
      domainConnectTemplateInput("news.brand.example", [
        ...RECORDS,
        { ...DMARC, status: "verified" },
      ])?.groupIds,
    ).toEqual(["mail"]);
  });

  it.each([
    [
      "an extra record",
      [
        ...RECORDS,
        record({
          record: "Tracking",
          type: "CNAME",
          name: "links.news.brand.example",
        }),
      ],
    ],
    [
      "a CNAME DKIM key",
      [{ ...RECORDS[0]!, type: "CNAME" }, ...RECORDS.slice(1)],
    ],
    [
      "another SPF value",
      [
        ...RECORDS.slice(0, 2),
        record({ name: "send.news.brand.example", value: "v=spf1 -all" }),
      ],
    ],
    ["a missing record", RECORDS.slice(0, 2)],
    [
      "a stricter DMARC value",
      [...RECORDS, { ...DMARC, value: "v=DMARC1; p=reject;" }],
    ],
  ])("refuses %s the template does not create", (_, records) => {
    expect(
      domainConnectTemplateInput("news.brand.example", records),
    ).toBeNull();
  });
});

describe("buildDomainConnectApplyUrl", () => {
  it("builds a signed synchronous apply URL with host for a subdomain", () => {
    const url = new URL(
      buildDomainConnectApplyUrl({
        urlSyncUX: "https://dash.provider.example/domainconnect/",
        zone: "brand.example",
        domain: "news.brand.example",
        variables: { dkimkey: "p=MIGfKEY+/=", mxhost: "feedback.example" },
        groupIds: ["mail", "dmarc"],
        redirectUri:
          "https://app.sokosumi.com/newsletter/settings?projectId=p1",
        privateKey,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://dash.provider.example/domainconnect/v2/domainTemplates/providers/sokosumi.com/services/newsletter/apply",
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      domain: "brand.example",
      host: "news",
      dkimkey: "p=MIGfKEY+/=",
      mxhost: "feedback.example",
      groupId: "mail,dmarc",
      redirect_uri: "https://app.sokosumi.com/newsletter/settings?projectId=p1",
      key: "_dck1",
    });

    // The signature covers the query exactly as sent, before sig and key.
    const query = url.search.slice(1);
    const signed = query.slice(0, query.indexOf("&sig="));
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signed);
    expect(
      verifier.verify(publicKey, url.searchParams.get("sig")!, "base64"),
    ).toBe(true);
  });

  it("omits host for the zone apex", () => {
    const url = new URL(
      buildDomainConnectApplyUrl({
        urlSyncUX: "https://dash.provider.example",
        zone: "brand.example",
        domain: "brand.example",
        variables: {},
        groupIds: ["mail"],
        redirectUri: "https://app.sokosumi.com/newsletter/settings",
        privateKey,
      }),
    );
    expect(url.searchParams.has("host")).toBe(false);
  });

  it("refuses a domain outside the zone", () => {
    expect(() =>
      buildDomainConnectApplyUrl({
        urlSyncUX: "https://dash.provider.example",
        zone: "brand.example",
        domain: "other.example",
        variables: {},
        groupIds: ["mail"],
        redirectUri: "https://app.sokosumi.com",
        privateKey,
      }),
    ).toThrow("outside");
  });
});

describe("discoverDomainConnectProvider", () => {
  const SETTINGS = {
    providerName: "cloudflare",
    providerDisplayName: "Cloudflare",
    urlSyncUX: "https://dash.cloudflare.com/domainconnect",
    urlAPI: "https://api.cloudflare.com/client/v4/dns/domainconnect",
  };

  it("walks up to the zone with _domainconnect and checks the template", async () => {
    m.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "_domainconnect.brand.example") {
        return [["api.cloudflare.com/client/v4/dns/domainconnect"]];
      }
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    });
    m.fetch
      .mockResolvedValueOnce(response(200, SETTINGS))
      .mockResolvedValueOnce(response(200, {}));

    await expect(
      discoverDomainConnectProvider("news.brand.example"),
    ).resolves.toEqual({
      zone: "brand.example",
      providerName: "Cloudflare",
      urlSyncUX: SETTINGS.urlSyncUX,
    });
    expect(m.fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.cloudflare.com/client/v4/dns/domainconnect/v2/brand.example/settings",
      "https://api.cloudflare.com/client/v4/dns/domainconnect/v2/domainTemplates/providers/sokosumi.com/services/newsletter",
    ]);
  });

  it("returns null until the provider serves the template", async () => {
    m.resolveTxt.mockResolvedValue([["api.provider.example"]]);
    m.fetch
      .mockResolvedValueOnce(response(200, SETTINGS))
      .mockResolvedValueOnce(response(404));

    await expect(
      discoverDomainConnectProvider("brand.example"),
    ).resolves.toBeNull();
  });

  it("returns null without _domainconnect or with unsafe settings", async () => {
    m.resolveTxt.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      discoverDomainConnectProvider("news.brand.example"),
    ).resolves.toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();

    m.resolveTxt.mockResolvedValue([["api.provider.example"]]);
    m.fetch.mockResolvedValueOnce(
      response(200, { ...SETTINGS, urlSyncUX: "http://insecure.example" }),
    );
    await expect(
      discoverDomainConnectProvider("brand.example"),
    ).resolves.toBeNull();

    m.resolveTxt.mockResolvedValue([["user:pass@internal host"]]);
    await expect(
      discoverDomainConnectProvider("brand.example"),
    ).resolves.toBeNull();
  });
});
