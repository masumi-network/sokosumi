import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({
  subscribers: vi.fn(),
  enabled: vi.fn(),
  list: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/clients/core.client", async () => ({
  CoreApiRequestError: (await import("@/lib/clients/core.request"))
    .CoreApiRequestError,
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: {
    listSubscribers: mocks.subscribers,
    isEnabled: mocks.enabled,
    listIssues: mocks.list,
  },
}));
vi.mock("./issues", () => ({ Issues: () => null }));

import NewsletterIssuesPage from "./page";

const PROPS = {
  params: Promise.resolve({ projectId: NEWSLETTER_PROJECT_ID }),
  searchParams: Promise.resolve({}),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.subscribers.mockResolvedValue({ data: { counts: { ACTIVE: 3 } } });
  mocks.list.mockResolvedValue({
    data: [NEWSLETTER_ISSUE],
    meta: {
      pagination: { cursor: null, limit: 25, total: 1, nextCursor: null },
    },
  });
});

describe("newsletter issues page", () => {
  it("hides disabled newsletters before fetching issues", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("forwards valid cursors and ignores malformed ones", async () => {
    await NewsletterIssuesPage({
      ...PROPS,
      searchParams: Promise.resolve({ cursor: NEWSLETTER_ISSUE.id }),
    });
    expect(mocks.list).toHaveBeenLastCalledWith(NEWSLETTER_PROJECT_ID, {
      limit: 25,
      cursor: NEWSLETTER_ISSUE.id,
    });
    await NewsletterIssuesPage({
      ...PROPS,
      searchParams: Promise.resolve({ cursor: "bad" }),
    });
    expect(mocks.list).toHaveBeenLastCalledWith(NEWSLETTER_PROJECT_ID, {
      limit: 25,
    });
  });
  it("handles missing projects while propagating Core outages", async () => {
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("NOT_FOUND");
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Unavailable", { status: 503 }),
    );
    await expect(NewsletterIssuesPage(PROPS)).rejects.toThrow("Unavailable");
  });
});
