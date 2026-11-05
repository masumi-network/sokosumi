import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CoreAuthUnavailableError,
  UnAuthenticatedError,
} from "@/lib/auth/errors";
import en from "@/messages/en.json";
import { NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ discover: vi.fn() }));
vi.mock("@/lib/actions/newsletter/sending-domain", () => ({
  getNewsletterSendingDomainConnect: mocks.discover,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({
      locale: "en",
      messages: en,
      namespace: "App.Projects.Newsletter.SendingDomain",
    }),
}));

import { GET } from "./route";

function discover(projectId = NEWSLETTER_PROJECT_ID) {
  return GET(new Request("https://web.test/api/domain-connect"), {
    params: Promise.resolve({ projectId }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("newsletter Domain Connect discovery proxy", () => {
  it.each([
    {
      providerName: "GoDaddy",
      applyUrl: "https://dns.provider.example/apply",
    },
    null,
  ])("returns discovery results without caching: %j", async (value) => {
    const result = { ok: true, value };
    mocks.discover.mockResolvedValue(result);

    const response = await discover();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
    expect(mocks.discover).toHaveBeenCalledWith({
      projectId: NEWSLETTER_PROJECT_ID,
    });
  });

  it("preserves the action's localized failure DTO", async () => {
    const result = {
      ok: false,
      error: {
        message: en.App.Projects.Newsletter.SendingDomain.errors.forbidden,
      },
    };
    mocks.discover.mockResolvedValue(result);

    const response = await discover();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(result);
  });

  it("rejects malformed project IDs before calling the action", async () => {
    const response = await discover("not-a-uuid");

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        message: en.App.Projects.Newsletter.SendingDomain.errors.domainRejected,
      },
    });
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it.each([
    [new UnAuthenticatedError(undefined, "Private authentication detail"), 401],
    [
      new CoreAuthUnavailableError("private reason", "Private auth detail"),
      503,
    ],
    [new Error("Private discovery detail"), 502],
  ])("returns a safe failure for %s", async (error, status) => {
    mocks.discover.mockRejectedValue(error);

    const response = await discover();

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        message: en.App.Projects.Newsletter.SendingDomain.errors.generic,
      },
    });
  });
});
