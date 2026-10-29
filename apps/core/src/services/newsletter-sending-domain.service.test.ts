import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudflareApiError } from "@/clients/cloudflare-dns.client";

import {
  assertNewsletterSenderConfigured,
  canManageNewsletterSendingDomain,
  checkNewsletterSendingDomain,
  connectNewsletterSendingDomainWithCloudflare,
  getNewsletterSendingDomain,
  getNewsletterSendingDomainConnect,
  putNewsletterSendingDomain,
  removeNewsletterSendingDomain,
  resolveNewsletterSender,
  resolveNewsletterSendingContext,
  resumeNewsletterSendingDomainWarmup,
} from "./newsletter-sending-domain.service";

const WORKSPACE_ID = "019a0000-0000-7000-8000-000000000001";
const TOKEN = "cf-secret-token-0123456789abcdef";
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  deleteMany: vi.fn(),
  memberFindFirst: vi.fn(),
  createDomain: vi.fn(),
  getDomain: vi.fn(),
  verifyDomain: vi.fn(),
  removeDomain: vi.fn(),
  cloudflareFactory: vi.fn(),
  listZones: vi.fn(),
  createDnsRecord: vi.fn(),
  discover: vi.fn(),
  hasDmarc: vi.fn(),
  env: {
    NEWSLETTER_FROM_DOMAIN: "news.sokosumi.example" as string | undefined,
    DOMAIN_CONNECT_PRIVATE_KEY: undefined as string | undefined,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    newsletterSendingDomain: {
      findUnique: m.findUnique,
      create: m.create,
      update: m.update,
      updateMany: m.updateMany,
      deleteMany: m.deleteMany,
    },
    member: { findFirst: m.memberFindFirst },
    $transaction: m.transaction,
  },
}));
vi.mock("@/clients/email.client", () => ({
  createEmailDomain: m.createDomain,
  getEmailDomain: m.getDomain,
  verifyEmailDomain: m.verifyDomain,
  removeEmailDomain: m.removeDomain,
}));
vi.mock("@/clients/cloudflare-dns.client", async (original) => ({
  ...(await original<typeof import("@/clients/cloudflare-dns.client")>()),
  cloudflareDnsClient: m.cloudflareFactory,
}));
vi.mock("@/lib/newsletter/domain-connect", async (original) => ({
  ...(await original<typeof import("@/lib/newsletter/domain-connect")>()),
  discoverDomainConnectProvider: m.discover,
}));
vi.mock("@/lib/newsletter/dmarc", () => ({ hasDmarcPolicy: m.hasDmarc }));
vi.mock("@/config/env", async (original) => {
  const actual = await original<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), ...m.env }),
    getWebAppBaseUrl: () => "https://app.sokosumi.example",
  };
});

const RESEND_RECORDS = [
  {
    record: "DKIM",
    type: "TXT",
    name: "resend._domainkey",
    value: "p=KEY",
    ttl: "Auto",
    status: "pending",
  },
  {
    record: "SPF",
    type: "MX",
    name: "send",
    value: "feedback-smtp.us-east-1.amazonses.com",
    ttl: "Auto",
    status: "pending",
    priority: 10,
  },
  {
    record: "SPF",
    type: "TXT",
    name: "send",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: "Auto",
    status: "pending",
  },
];
const STORED_RECORDS = [
  {
    record: "DKIM",
    type: "TXT",
    name: "resend._domainkey.brand.example",
    value: "p=KEY",
    ttl: "Auto",
    priority: null,
    status: "pending",
  },
  {
    record: "SPF",
    type: "MX",
    name: "send.brand.example",
    value: "feedback-smtp.us-east-1.amazonses.com",
    ttl: "Auto",
    priority: 10,
    status: "pending",
  },
  {
    record: "SPF",
    type: "TXT",
    name: "send.brand.example",
    value: "v=spf1 include:amazonses.com ~all",
    ttl: "Auto",
    priority: null,
    status: "pending",
  },
];
const NOW = new Date("2026-10-27T12:00:00Z");
const ROW = {
  id: "019a0000-0000-7000-8000-000000000002",
  workspaceId: WORKSPACE_ID,
  domain: "brand.example",
  fromAddress: "news@brand.example",
  resendDomainId: "resend_domain_1",
  status: "PENDING" as const,
  dnsRecords: STORED_RECORDS,
  lastCheckedAt: NOW,
  failureReason: null,
  createdAt: NOW,
  updatedAt: NOW,
  warmupStartedAt: null,
  warmupPausedAt: null,
  warmupPauseReason: null,
  warmupSentOnDayUtc: null,
  warmupSentCount: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  m.env.NEWSLETTER_FROM_DOMAIN = "news.sokosumi.example";
  m.env.DOMAIN_CONNECT_PRIVATE_KEY = undefined;
  m.findUnique.mockResolvedValue(ROW);
  m.update.mockImplementation(async ({ data }) => ({
    ...ROW,
    ...m.updateMany.mock.lastCall?.[0].data,
    ...data,
  }));
  m.updateMany.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(async (callback) =>
    callback({
      newsletterSendingDomain: { update: m.update, updateMany: m.updateMany },
    }),
  );
  m.create.mockImplementation(async ({ data }) => ({ ...ROW, ...data }));
  m.getDomain.mockResolvedValue({
    id: ROW.resendDomainId,
    status: "verified",
    records: RESEND_RECORDS.map((record) => ({
      ...record,
      status: "verified",
    })),
  });
  m.cloudflareFactory.mockReturnValue({
    listZones: m.listZones,
    createDnsRecord: m.createDnsRecord,
  });
  m.createDnsRecord.mockResolvedValue(true);
  m.hasDmarc.mockResolvedValue(true);
});

const DMARC_SUGGESTION = {
  record: "DMARC",
  type: "TXT",
  name: "_dmarc.brand.example",
  value: "v=DMARC1; p=none;",
  ttl: "Auto",
  priority: null,
  status: "not_found",
};

describe("canManageNewsletterSendingDomain", () => {
  const ORG_WORKSPACE = {
    workspaceId: WORKSPACE_ID,
    userId: null,
    organizationId: "org_1",
  };

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ])("lets an organization %s manage: %s", async (role, allowed) => {
    m.memberFindFirst.mockResolvedValue({ role });
    await expect(
      canManageNewsletterSendingDomain("user_1", ORG_WORKSPACE),
    ).resolves.toBe(allowed);
    expect(m.memberFindFirst).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        organization: { workspace: { id: WORKSPACE_ID } },
      },
      select: { role: true },
    });
  });

  it("refuses a non-member and allows only a personal workspace's owner", async () => {
    m.memberFindFirst.mockResolvedValue(null);
    await expect(
      canManageNewsletterSendingDomain("user_1", ORG_WORKSPACE),
    ).resolves.toBe(false);
    const personal = {
      workspaceId: WORKSPACE_ID,
      userId: "user_1",
      organizationId: null,
    };
    await expect(
      canManageNewsletterSendingDomain("user_1", personal),
    ).resolves.toBe(true);
    await expect(
      canManageNewsletterSendingDomain("user_2", personal),
    ).resolves.toBe(false);
  });
});

describe("putNewsletterSendingDomain", () => {
  it("registers a new domain with Resend and stores its records", async () => {
    m.findUnique.mockResolvedValue(null);
    m.createDomain.mockResolvedValue({
      id: "resend_domain_1",
      status: "not_started",
      records: RESEND_RECORDS,
    });

    const domain = await putNewsletterSendingDomain(
      WORKSPACE_ID,
      "News@Brand.Example",
    );

    expect(m.createDomain).toHaveBeenCalledWith("brand.example");
    expect(m.create).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_ID,
        domain: "brand.example",
        fromAddress: "News@brand.example",
        resendDomainId: "resend_domain_1",
        status: "PENDING",
        dnsRecords: STORED_RECORDS,
        lastCheckedAt: NOW,
      },
    });
    expect(domain.status).toBe("PENDING");
  });

  it("suggests a p=none DMARC record when the domain has no policy", async () => {
    m.findUnique.mockResolvedValue(null);
    m.hasDmarc.mockResolvedValue(false);
    m.createDomain.mockResolvedValue({
      id: "resend_domain_1",
      status: "not_started",
      records: RESEND_RECORDS,
    });
    await putNewsletterSendingDomain(WORKSPACE_ID, "news@brand.example");
    expect(m.hasDmarc).toHaveBeenCalledWith("brand.example");
    expect(m.create.mock.calls[0]![0].data.dnsRecords).toEqual([
      ...STORED_RECORDS,
      DMARC_SUGGESTION,
    ]);
  });

  it("only changes the address for the same domain", async () => {
    await putNewsletterSendingDomain(WORKSPACE_ID, "hello@brand.example");
    expect(m.createDomain).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith({
      where: { id: ROW.id },
      data: { fromAddress: "hello@brand.example" },
    });
  });

  it("refuses a second domain and a domain another workspace holds", async () => {
    await expect(
      putNewsletterSendingDomain(WORKSPACE_ID, "news@other.example"),
    ).rejects.toMatchObject({ status: 409 });

    m.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "other" });
    await expect(
      putNewsletterSendingDomain(WORKSPACE_ID, "news@brand.example"),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.createDomain).not.toHaveBeenCalled();
  });

  it("reports a Resend refusal and removes a domain no row could keep", async () => {
    m.findUnique.mockResolvedValue(null);
    m.createDomain.mockRejectedValueOnce(
      Object.assign(new Error("The domain is invalid"), { statusCode: 422 }),
    );
    await expect(
      putNewsletterSendingDomain(WORKSPACE_ID, "news@brand.example"),
    ).rejects.toMatchObject({ status: 422 });

    m.createDomain.mockResolvedValue({
      id: "resend_domain_2",
      status: "not_started",
      records: [],
    });
    m.create.mockRejectedValue(new Error("database down"));
    m.removeDomain.mockResolvedValue(undefined);
    await expect(
      putNewsletterSendingDomain(WORKSPACE_ID, "news@brand.example"),
    ).rejects.toThrow("database down");
    expect(m.removeDomain).toHaveBeenCalledWith("resend_domain_2");
  });
});

describe("checking", () => {
  it("asks Resend to verify, then stores status, records and lastCheckedAt", async () => {
    const domain = await checkNewsletterSendingDomain(WORKSPACE_ID);

    expect(m.verifyDomain).toHaveBeenCalledWith(ROW.resendDomainId);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: ROW.id },
      data: expect.objectContaining({
        status: "VERIFIED",
        lastCheckedAt: NOW,
        failureReason: null,
      }),
    });
    expect(domain.status).toBe("VERIFIED");
  });

  it("checks off the DMARC suggestion once the policy is published", async () => {
    m.findUnique.mockResolvedValue({
      ...ROW,
      dnsRecords: [...STORED_RECORDS, DMARC_SUGGESTION],
    });
    const domain = await checkNewsletterSendingDomain(WORKSPACE_ID);
    expect(domain.dnsRecords).toContainEqual({
      ...DMARC_SUGGESTION,
      status: "verified",
    });
  });

  it("stores a failure reason naming the failed records", async () => {
    m.getDomain.mockResolvedValue({
      status: "failed",
      records: [{ ...RESEND_RECORDS[0], status: "failed" }],
    });
    const domain = await checkNewsletterSendingDomain(WORKSPACE_ID);
    expect(domain.status).toBe("FAILED");
    expect(domain.failureReason).toContain("resend._domainkey.brand.example");
  });

  it("404s without a domain", async () => {
    m.findUnique.mockResolvedValue(null);
    await expect(
      checkNewsletterSendingDomain(WORKSPACE_ID),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("re-reads a stale pending domain lazily, without asking Resend to verify", async () => {
    m.findUnique.mockResolvedValue({
      ...ROW,
      lastCheckedAt: new Date(NOW.getTime() - 120_000),
    });
    expect((await getNewsletterSendingDomain(WORKSPACE_ID))?.status).toBe(
      "VERIFIED",
    );
    expect(m.verifyDomain).not.toHaveBeenCalled();
    expect(m.getDomain).toHaveBeenCalledOnce();
  });

  it("does not re-read a fresh or verified domain, and survives a Resend outage", async () => {
    await getNewsletterSendingDomain(WORKSPACE_ID);
    m.findUnique.mockResolvedValue({
      ...ROW,
      status: "VERIFIED",
      lastCheckedAt: null,
    });
    await getNewsletterSendingDomain(WORKSPACE_ID);
    expect(m.getDomain).not.toHaveBeenCalled();

    const stale = { ...ROW, lastCheckedAt: null };
    m.findUnique.mockResolvedValue(stale);
    m.getDomain.mockRejectedValue(new Error("Resend down"));
    await expect(
      getNewsletterSendingDomain(WORKSPACE_ID),
    ).resolves.toMatchObject(stale);
  });
});

describe("removeNewsletterSendingDomain", () => {
  it("removes the domain in Resend, then the row", async () => {
    await removeNewsletterSendingDomain(WORKSPACE_ID);
    expect(m.removeDomain).toHaveBeenCalledWith(ROW.resendDomainId);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: ROW.id } });
  });

  it("still removes the row when Resend no longer has the domain", async () => {
    m.removeDomain.mockRejectedValue(
      Object.assign(new Error("Domain not found"), { statusCode: 404 }),
    );
    await removeNewsletterSendingDomain(WORKSPACE_ID);
    expect(m.deleteMany).toHaveBeenCalled();
  });

  it("keeps the row when Resend fails otherwise, so nothing is stranded", async () => {
    m.removeDomain.mockRejectedValue(
      Object.assign(new Error("Internal"), { statusCode: 500 }),
    );
    await expect(
      removeNewsletterSendingDomain(WORKSPACE_ID),
    ).rejects.toMatchObject({ status: 502 });
    expect(m.deleteMany).not.toHaveBeenCalled();
  });
});

describe("connectNewsletterSendingDomainWithCloudflare", () => {
  it("creates every record in the token's matching zone, then checks", async () => {
    m.listZones.mockResolvedValue([{ id: "zone_1", name: "brand.example" }]);

    const domain = await connectNewsletterSendingDomainWithCloudflare(
      WORKSPACE_ID,
      TOKEN,
    );

    expect(m.cloudflareFactory).toHaveBeenCalledWith(TOKEN);
    expect(m.listZones).toHaveBeenCalledWith("brand.example");
    expect(m.createDnsRecord.mock.calls).toEqual([
      [
        "zone_1",
        {
          type: "TXT",
          name: "resend._domainkey.brand.example",
          content: "p=KEY",
        },
      ],
      [
        "zone_1",
        {
          type: "MX",
          name: "send.brand.example",
          content: "feedback-smtp.us-east-1.amazonses.com",
          priority: 10,
        },
      ],
      [
        "zone_1",
        {
          type: "TXT",
          name: "send.brand.example",
          content: "v=spf1 include:amazonses.com ~all",
        },
      ],
    ]);
    expect(m.verifyDomain).toHaveBeenCalled();
    expect(domain.status).toBe("VERIFIED");
    // The token is never written anywhere.
    expect(JSON.stringify(m.update.mock.calls)).not.toContain(TOKEN);
  });

  it("adds the suggested DMARC record only if DMARC is still missing", async () => {
    m.listZones.mockResolvedValue([{ id: "zone_1", name: "brand.example" }]);
    m.findUnique.mockResolvedValue({
      ...ROW,
      dnsRecords: [...STORED_RECORDS, DMARC_SUGGESTION],
    });
    m.hasDmarc.mockResolvedValue(false);
    await connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN);
    expect(m.createDnsRecord).toHaveBeenCalledWith("zone_1", {
      type: "TXT",
      name: "_dmarc.brand.example",
      content: "v=DMARC1; p=none;",
    });

    m.createDnsRecord.mockClear();
    // Published meanwhile: a second policy would invalidate both.
    m.hasDmarc.mockResolvedValue(true);
    await connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN);
    expect(
      m.createDnsRecord.mock.calls.map(([, record]) => record.name),
    ).not.toContain("_dmarc.brand.example");
  });

  it("finds a subdomain's parent zone", async () => {
    m.findUnique.mockResolvedValue({
      ...ROW,
      domain: "news.brand.example",
      dnsRecords: [
        { ...STORED_RECORDS[0], name: "resend._domainkey.news.brand.example" },
      ],
    });
    m.listZones.mockImplementation(async (name: string) =>
      name === "brand.example" ? [{ id: "zone_1", name }] : [],
    );
    await connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN);
    expect(m.listZones.mock.calls).toEqual([
      ["news.brand.example"],
      ["brand.example"],
    ]);
    expect(m.createDnsRecord).toHaveBeenCalledOnce();
  });

  it("refuses a token whose zone does not match the domain", async () => {
    m.listZones.mockResolvedValue([{ id: "zone_9", name: "other.example" }]);
    const error = await connectNewsletterSendingDomainWithCloudflare(
      WORKSPACE_ID,
      TOKEN,
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 422 });
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(m.createDnsRecord).not.toHaveBeenCalled();
  });

  it("maps a rejected token to 422 and other Cloudflare failures to 502", async () => {
    m.listZones.mockRejectedValueOnce(new CloudflareApiError(403, [10000]));
    await expect(
      connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN),
    ).rejects.toMatchObject({ status: 422 });

    // A Global API Key pasted as a token: HTTP 400, not 401/403.
    m.listZones.mockRejectedValueOnce(
      new CloudflareApiError(400, [6003, 6111]),
    );
    await expect(
      connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN),
    ).rejects.toMatchObject({ status: 422 });

    m.listZones.mockResolvedValue([{ id: "zone_1", name: "brand.example" }]);
    m.createDnsRecord.mockRejectedValue(new CloudflareApiError(500, []));
    await expect(
      connectNewsletterSendingDomainWithCloudflare(WORKSPACE_ID, TOKEN),
    ).rejects.toMatchObject({ status: 502 });
  });
});

describe("getNewsletterSendingDomainConnect", () => {
  const PROVIDER = {
    zone: "brand.example",
    providerName: "Cloudflare",
    urlSyncUX: "https://dash.cloudflare.com/domainconnect",
  };

  it("returns a signed apply URL back to the project's settings", async () => {
    m.env.DOMAIN_CONNECT_PRIVATE_KEY = privateKey;
    m.discover.mockResolvedValue(PROVIDER);

    const connect = await getNewsletterSendingDomainConnect(
      WORKSPACE_ID,
      "019a0000-0000-7000-8000-000000000003",
    );

    expect(m.discover).toHaveBeenCalledWith("brand.example");
    expect(connect?.providerName).toBe("Cloudflare");
    const url = new URL(connect!.applyUrl);
    expect(url.searchParams.get("domain")).toBe("brand.example");
    expect(url.searchParams.get("dkimkey")).toBe("p=KEY");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.sokosumi.example/newsletter/settings?projectId=019a0000-0000-7000-8000-000000000003",
    );
    expect(url.searchParams.get("sig")).toBeTruthy();
    expect(url.searchParams.get("groupId")).toBe("mail");
  });

  it("applies only the DMARC group to a verified domain missing DMARC", async () => {
    m.env.DOMAIN_CONNECT_PRIVATE_KEY = privateKey;
    m.discover.mockResolvedValue(PROVIDER);
    m.findUnique.mockResolvedValue({
      ...ROW,
      status: "VERIFIED",
      dnsRecords: [...STORED_RECORDS, DMARC_SUGGESTION],
    });
    const connect = await getNewsletterSendingDomainConnect(
      WORKSPACE_ID,
      undefined,
    );
    expect(new URL(connect!.applyUrl).searchParams.get("groupId")).toBe(
      "dmarc",
    );
  });

  it("applies the DMARC group while DMARC is missing", async () => {
    m.env.DOMAIN_CONNECT_PRIVATE_KEY = privateKey;
    m.discover.mockResolvedValue(PROVIDER);
    m.findUnique.mockResolvedValue({
      ...ROW,
      dnsRecords: [...STORED_RECORDS, DMARC_SUGGESTION],
    });
    const connect = await getNewsletterSendingDomainConnect(
      WORKSPACE_ID,
      undefined,
    );
    expect(new URL(connect!.applyUrl).searchParams.get("groupId")).toBe(
      "mail,dmarc",
    );
  });

  it("returns null without a signing key, once verified, or without provider support", async () => {
    m.discover.mockResolvedValue(PROVIDER);
    await expect(
      getNewsletterSendingDomainConnect(WORKSPACE_ID, undefined),
    ).resolves.toBeNull();

    m.env.DOMAIN_CONNECT_PRIVATE_KEY = privateKey;
    m.findUnique.mockResolvedValue({ ...ROW, status: "VERIFIED" });
    await expect(
      getNewsletterSendingDomainConnect(WORKSPACE_ID, undefined),
    ).resolves.toBeNull();

    m.findUnique.mockResolvedValue(ROW);
    m.discover.mockResolvedValue(null);
    await expect(
      getNewsletterSendingDomainConnect(WORKSPACE_ID, undefined),
    ).resolves.toBeNull();
  });
});

describe("resolveNewsletterSender", () => {
  const NEWSLETTER = {
    workspaceId: WORKSPACE_ID,
    senderName: "Brand",
    replyTo: "hello@brand.example",
  };

  it("sends from the verified workspace address", async () => {
    m.findUnique.mockResolvedValue({ ...ROW, status: "VERIFIED" });
    await expect(resolveNewsletterSender(NEWSLETTER)).resolves.toEqual({
      from: '"Brand" <news@brand.example>',
      replyTo: "hello@brand.example",
    });
  });

  it("re-reads a stale pending domain before sending, without DNS lookups", async () => {
    m.findUnique.mockResolvedValue({ ...ROW, lastCheckedAt: null });
    await expect(resolveNewsletterSender(NEWSLETTER)).resolves.toMatchObject({
      from: '"Brand" <news@brand.example>',
    });
    expect(m.getDomain).toHaveBeenCalledOnce();
    expect(m.hasDmarc).not.toHaveBeenCalled();
  });

  it("falls back via Sokosumi while pending, and refuses without a fallback", async () => {
    m.getDomain.mockResolvedValue({ status: "pending", records: [] });
    await expect(resolveNewsletterSender(NEWSLETTER)).resolves.toEqual({
      from: '"Brand via Sokosumi" <newsletter@news.sokosumi.example>',
      replyTo: "hello@brand.example",
    });
    m.env.NEWSLETTER_FROM_DOMAIN = undefined;
    m.findUnique.mockResolvedValue(null);
    await expect(resolveNewsletterSender(NEWSLETTER)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("sending-domain warm-up", () => {
  it("starts the UTC ramp on first verification and preserves its original start", async () => {
    const domain = await checkNewsletterSendingDomain(WORKSPACE_ID);
    expect(domain.warmup).toEqual({
      startedAt: NOW,
      day: 0,
      dailyCap: 50,
      sentToday: 0,
      pausedAt: null,
      pauseReason: null,
    });
    const startedAt = new Date("2026-10-24T23:59:59Z");
    m.findUnique.mockResolvedValue({ ...ROW, warmupStartedAt: startedAt });
    m.update.mockImplementation(async ({ data }) => ({
      ...ROW,
      warmupStartedAt: startedAt,
      ...data,
    }));
    expect((await checkNewsletterSendingDomain(WORKSPACE_ID)).warmup.day).toBe(
      3,
    );
    expect(m.update.mock.lastCall?.[0].data).not.toHaveProperty(
      "warmupStartedAt",
    );
  });

  it("never overwrites the first verification timestamp when concurrent checks return a stale row", async () => {
    const firstStartedAt = new Date(NOW.getTime() - 500);
    m.updateMany.mockResolvedValue({ count: 0 });
    m.update.mockImplementation(async ({ data }) => ({
      ...ROW,
      warmupStartedAt: firstStartedAt,
      ...data,
    }));
    const domain = await checkNewsletterSendingDomain(WORKSPACE_ID);
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: ROW.id, warmupStartedAt: null, status: { not: "VERIFIED" } },
      data: { warmupStartedAt: NOW },
    });
    expect(m.update.mock.lastCall?.[0].data).not.toHaveProperty(
      "warmupStartedAt",
    );
    expect(domain.warmup.startedAt).toEqual(firstStartedAt);
  });

  it("starts a domain already verified when created, leaving existing verified rows exempt", async () => {
    m.findUnique.mockResolvedValue(null);
    m.createDomain.mockResolvedValue({
      id: "resend_domain_1",
      status: "verified",
      records: RESEND_RECORDS,
    });
    expect(
      (await putNewsletterSendingDomain(WORKSPACE_ID, "news@brand.example"))
        .warmup.startedAt,
    ).toEqual(NOW);
    m.findUnique.mockResolvedValue({ ...ROW, status: "VERIFIED" });
    expect(
      (await checkNewsletterSendingDomain(WORKSPACE_ID)).warmup.startedAt,
    ).toBeNull();
    expect(m.update.mock.lastCall?.[0].data).not.toHaveProperty(
      "warmupStartedAt",
    );
  });

  it("shows today's transactional usage and resets yesterday's displayed usage", async () => {
    const verified = {
      ...ROW,
      status: "VERIFIED",
      warmupStartedAt: NOW,
      warmupSentOnDayUtc: new Date("2026-10-27T00:00:00Z"),
      warmupSentCount: 21,
    };
    m.findUnique.mockResolvedValue(verified);
    expect(
      (await getNewsletterSendingDomain(WORKSPACE_ID))?.warmup.sentToday,
    ).toBe(21);
    m.findUnique.mockResolvedValue({
      ...verified,
      warmupSentOnDayUtc: new Date("2026-10-26T00:00:00Z"),
    });
    expect(
      (await getNewsletterSendingDomain(WORKSPACE_ID))?.warmup.sentToday,
    ).toBe(0);
  });

  it.each(["VERIFIED", "FAILED", "PENDING"])(
    "blocks paused %s custom senders without switching to shared fallback",
    async (status) => {
      m.findUnique.mockResolvedValue({
        ...ROW,
        status,
        warmupStartedAt: NOW,
        warmupPausedAt: NOW,
      });
      const newsletter = {
        workspaceId: WORKSPACE_ID,
        senderName: "Brand",
        replyTo: "editor@brand.example",
      };
      await expect(resolveNewsletterSender(newsletter)).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        assertNewsletterSenderConfigured(WORKSPACE_ID),
      ).rejects.toMatchObject({ status: 409 });
      const context = await resolveNewsletterSendingContext(newsletter);
      expect(context.domain?.warmupPausedAt).toEqual(NOW);
      expect(context.sender.from).toContain("news@brand.example");
    },
  );

  it("does not attach warm-up to a pending domain's shared sender", async () => {
    const context = await resolveNewsletterSendingContext({
      workspaceId: WORKSPACE_ID,
      senderName: "Brand",
      replyTo: "editor@brand.example",
    });
    expect(context.domain).toBeNull();
    expect(context.sender.from).toContain("via Sokosumi");
  });

  it("resumes by clearing only pause fields, preserving the ramp and cap usage", async () => {
    m.findUnique.mockResolvedValue({
      ...ROW,
      status: "VERIFIED",
      warmupStartedAt: NOW,
      warmupPausedAt: NOW,
      warmupPauseReason: "BOUNCE_RATE",
    });
    await resumeNewsletterSendingDomainWarmup(WORKSPACE_ID);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: ROW.id },
      data: { warmupPausedAt: null, warmupPauseReason: null },
    });
  });

  it("refuses to resume an unverified or pre-warm-up domain", async () => {
    await expect(
      resumeNewsletterSendingDomainWarmup(WORKSPACE_ID),
    ).rejects.toMatchObject({ status: 409 });
    m.findUnique.mockResolvedValue({ ...ROW, status: "VERIFIED" });
    await expect(
      resumeNewsletterSendingDomainWarmup(WORKSPACE_ID),
    ).rejects.toMatchObject({ status: 409 });
    expect(m.update).not.toHaveBeenCalled();
  });
});
