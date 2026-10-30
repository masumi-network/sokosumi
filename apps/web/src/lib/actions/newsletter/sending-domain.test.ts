import type { NewsletterSendingDomain } from "@sokosumi/core-client";
import { revalidatePath } from "next/cache";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";
import en from "@/messages/en.json";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  check: vi.fn(),
  remove: vi.fn(),
  cloudflare: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "App.Projects.Newsletter.SendingDomain") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/middleware/auth-middleware", () => ({
  withSession: <T extends object, R>(handler: (params: T) => Promise<R>) =>
    handler,
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    saveSendingDomain: mocks.save,
    checkSendingDomain: mocks.check,
    removeSendingDomain: mocks.remove,
    connectSendingDomainWithCloudflare: mocks.cloudflare,
    getSendingDomainConnect: mocks.connect,
  },
}));

import {
  checkNewsletterSendingDomain,
  connectNewsletterSendingDomainWithCloudflare,
  getNewsletterSendingDomainConnect,
  removeNewsletterSendingDomain,
  saveNewsletterSendingDomain,
} from "./sending-domain";

const T = en.App.Projects.Newsletter.SendingDomain;
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "cf-secret-token-0123456789abcdef";
const DOMAIN: NewsletterSendingDomain = {
  id: "d1",
  domain: "brand.example",
  fromAddress: "news@brand.example",
  status: "PENDING",
  dnsRecords: [],
  lastCheckedAt: null,
  failureReason: null,
  createdAt: new Date(),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue(DOMAIN);
  mocks.check.mockResolvedValue(DOMAIN);
  mocks.cloudflare.mockResolvedValue(DOMAIN);
});

describe("sending domain actions", () => {
  it("saves a trimmed From address and revalidates settings", async () => {
    const result = await saveNewsletterSendingDomain({
      projectId: PROJECT_ID,
      fromAddress: " news@brand.example ",
    });
    expect(result).toEqual({ ok: true, value: DOMAIN });
    expect(mocks.save).toHaveBeenCalledWith(PROJECT_ID, "news@brand.example");
    expect(revalidatePath).toHaveBeenCalledWith("/newsletter/settings");
  });

  it("refuses an invalid address without calling Core", async () => {
    const result = await saveNewsletterSendingDomain({
      projectId: PROJECT_ID,
      fromAddress: "Brand <news@brand.example>",
    });
    expect(result).toEqual({
      ok: false,
      error: { message: T.errors.invalidAddress },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    [403, T.errors.forbidden],
    [409, T.errors.conflict],
    [422, T.errors.domainRejected],
    [502, T.errors.providerFailed],
    [500, T.errors.generic],
  ])("maps Core %s to plain copy", async (status, message) => {
    mocks.save.mockRejectedValue(new CoreApiRequestError("x", { status }));
    expect(
      await saveNewsletterSendingDomain({
        projectId: PROJECT_ID,
        fromAddress: "news@brand.example",
      }),
    ).toEqual({ ok: false, error: { message } });
  });

  it("passes the Cloudflare token straight to Core and never echoes it", async () => {
    expect(
      await connectNewsletterSendingDomainWithCloudflare({
        projectId: PROJECT_ID,
        apiToken: ` ${TOKEN} `,
      }),
    ).toEqual({ ok: true, value: DOMAIN });
    expect(mocks.cloudflare).toHaveBeenCalledWith(PROJECT_ID, TOKEN);

    mocks.cloudflare.mockRejectedValue(
      new CoreApiRequestError(`bad ${TOKEN}`, { status: 422 }),
    );
    const failed = await connectNewsletterSendingDomainWithCloudflare({
      projectId: PROJECT_ID,
      apiToken: TOKEN,
    });
    expect(failed).toEqual({
      ok: false,
      error: { message: T.errors.cloudflareRejected },
    });
    expect(JSON.stringify(failed)).not.toContain(TOKEN);
  });

  it("checks, removes and looks up Domain Connect for the current project", async () => {
    expect(
      (await checkNewsletterSendingDomain({ projectId: PROJECT_ID })).ok,
    ).toBe(true);
    expect(mocks.check).toHaveBeenCalledWith(PROJECT_ID);
    expect(
      (await removeNewsletterSendingDomain({ projectId: PROJECT_ID })).ok,
    ).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith(PROJECT_ID);

    mocks.connect.mockResolvedValue(null);
    await getNewsletterSendingDomainConnect({ projectId: PROJECT_ID });
    expect(mocks.connect).toHaveBeenCalledWith(PROJECT_ID);
  });
});
