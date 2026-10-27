import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEWSLETTER_ISSUE, NEWSLETTER_PROJECT_ID } from "@/test/newsletter";

const mocks = vi.hoisted(() => ({ enabled: vi.fn(), get: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/services/newsletter.service", () => ({
  newsletterService: { isEnabled: mocks.enabled, getIssue: mocks.get },
}));
vi.mock("@/app/projects/[projectId]/newsletter/issues/issue-editor", () => ({
  NewsletterIssueEditor: () => null,
}));

import NewsletterIssuePage from "./page";

const PROPS = {
  params: Promise.resolve({
    projectId: NEWSLETTER_PROJECT_ID,
    issueId: NEWSLETTER_ISSUE.id,
  }),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enabled.mockResolvedValue(true);
  mocks.get.mockResolvedValue(NEWSLETTER_ISSUE);
});
describe("newsletter issue page", () => {
  it("loads a scoped issue from Core", async () => {
    const result = await NewsletterIssuePage(PROPS);
    expect(mocks.get).toHaveBeenCalledWith(
      NEWSLETTER_PROJECT_ID,
      NEWSLETTER_ISSUE.id,
    );
    expect(result.props.issue).toBe(NEWSLETTER_ISSUE);
  });
  it("hides disabled newsletters and missing issues", async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.enabled.mockResolvedValue(true);
    mocks.get.mockResolvedValue(null);
    await expect(NewsletterIssuePage(PROPS)).rejects.toThrow("NOT_FOUND");
  });
});
