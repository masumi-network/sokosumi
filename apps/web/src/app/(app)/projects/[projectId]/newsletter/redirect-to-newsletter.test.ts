import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enabled: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: mocks.enabled },
}));

import ProjectNewsletterIssueRedirect from "./issues/[issueId]/page";
import ProjectNewsletterIssuesRedirect from "./issues/page";
import ProjectNewsletterRedirect from "./page";
import ProjectNewsletterSubscribersRedirect from "./subscribers/page";

function props(searchParams: Record<string, string | string[]> = {}) {
  return {
    params: Promise.resolve({ projectId: "p 1", issueId: "i/1" }),
    searchParams: Promise.resolve(searchParams),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
});

describe("old project newsletter routes", () => {
  it.each([
    [ProjectNewsletterRedirect, "/newsletter/settings?projectId=p+1"],
    [ProjectNewsletterIssuesRedirect, "/newsletter/issues?projectId=p+1"],
    [ProjectNewsletterIssueRedirect, "/newsletter/issues/i%2F1?projectId=p+1"],
    [
      ProjectNewsletterSubscribersRedirect,
      "/newsletter/subscribers?projectId=p+1",
    ],
  ])("redirect to the top-level section", async (page, target) => {
    await expect(page(props())).rejects.toThrow(`REDIRECT:${target}`);
  });

  it("keeps the rest of the query and drops a stale projectId", async () => {
    await expect(
      ProjectNewsletterSubscribersRedirect(
        props({ status: "ACTIVE", cursor: "c1", projectId: "other" }),
      ),
    ).rejects.toThrow(
      "REDIRECT:/newsletter/subscribers?projectId=p+1&status=ACTIVE&cursor=c1",
    );
  });

  it("stays hidden while newsletters are disabled", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(ProjectNewsletterRedirect(props())).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
