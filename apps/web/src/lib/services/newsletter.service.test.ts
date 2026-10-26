import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import {
  NEWSLETTER_ANALYTICS,
  NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER,
  PUBLIC_NEWSLETTER_ISSUE,
  PUBLIC_NEWSLETTER_ISSUE_SUMMARY,
  PUBLIC_NEWSLETTER_SLUG,
} from "@/test/newsletter";

const core = vi.hoisted(() => ({
  postPublicNewslettersByPublicSlugSubscribe: vi.fn(),
  getPublicNewslettersByPublicSlug: vi.fn(),
  getPublicNewslettersByPublicSlugIssues: vi.fn(),
  getPublicNewslettersByPublicSlugIssuesByIssueSlug: vi.fn(),
  getProjectsByIdNewsletterIssues: vi.fn(),
  getProjectsByIdNewsletterAnalytics: vi.fn(),
  getProjectsByIdNewsletterIssuesByIssueIdAnalytics: vi.fn(),
  getProjectsByIdNewsletterIssuesByIssueId: vi.fn(),
  postProjectsByIdNewsletterIssues: vi.fn(),
  postProjectsByIdNewsletterIssuesDraftWithAi: vi.fn(),
  patchProjectsByIdNewsletterIssuesByIssueId: vi.fn(),
  deleteProjectsByIdNewsletterIssuesByIssueId: vi.fn(),
  postProjectsByIdNewsletterIssuesPreview: vi.fn(),
  getNewsletterAvailability: vi.fn(),
  getProjectsByIdNewsletter: vi.fn(),
  putProjectsByIdNewsletter: vi.fn(),
  getProjectsByIdNewsletterSubscribers: vi.fn(),
  postProjectsByIdNewsletterSubscribers: vi.fn(),
  postProjectsByIdNewsletterSubscribersImport: vi.fn(),
  patchProjectsByIdNewsletterSubscribersBySubscriberId: vi.fn(),
  deleteProjectsByIdNewsletterSubscribersBySubscriberId: vi.fn(),
}));
const requestHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("@/lib/clients/core.client", async () => {
  const { CoreApiRequestError } = await import("@/lib/clients/core.request");
  return { coreClient: core, CoreApiRequestError };
});

import { newsletterService } from "./newsletter.service";

beforeEach(() => {
  vi.resetAllMocks();
  requestHeaders.mockResolvedValue(new Headers());
});

describe("newsletterService", () => {
  it("drafts through the generated endpoint and preserves Core failures", async () => {
    const input = { brief: "Launch" };
    core.postProjectsByIdNewsletterIssuesDraftWithAi.mockResolvedValue({
      data: NEWSLETTER_ISSUE,
    });
    expect(
      await newsletterService.draftIssue(NEWSLETTER_ISSUE.projectId, input),
    ).toBe(NEWSLETTER_ISSUE);
    expect(
      core.postProjectsByIdNewsletterIssuesDraftWithAi,
    ).toHaveBeenCalledExactlyOnceWith(NEWSLETTER_ISSUE.projectId, input);
    const error = new CoreApiRequestError("Unavailable", { status: 503 });
    core.postProjectsByIdNewsletterIssuesDraftWithAi.mockRejectedValue(error);
    await expect(
      newsletterService.draftIssue(NEWSLETTER_ISSUE.projectId, input),
    ).rejects.toBe(error);
  });
  it("loads scoped analytics through the generated Core operations", async () => {
    core.getProjectsByIdNewsletterAnalytics.mockResolvedValue({
      data: NEWSLETTER_ANALYTICS,
    });
    const query = { from: "2026-10-01", to: "2026-10-02" };
    expect(
      await newsletterService.getAnalytics(NEWSLETTER_ISSUE.projectId, query),
    ).toBe(NEWSLETTER_ANALYTICS);
    expect(
      core.getProjectsByIdNewsletterAnalytics,
    ).toHaveBeenCalledExactlyOnceWith(NEWSLETTER_ISSUE.projectId, query);
    const issue = { totals: NEWSLETTER_ANALYTICS.totals, topLinks: [] };
    core.getProjectsByIdNewsletterIssuesByIssueIdAnalytics.mockResolvedValue({
      data: issue,
    });
    expect(
      await newsletterService.getIssueAnalytics(
        NEWSLETTER_ISSUE.projectId,
        NEWSLETTER_ISSUE.id,
      ),
    ).toBe(issue);
    expect(
      core.getProjectsByIdNewsletterIssuesByIssueIdAnalytics,
    ).toHaveBeenCalledExactlyOnceWith(
      NEWSLETTER_ISSUE.projectId,
      NEWSLETTER_ISSUE.id,
    );
  });
  it("preserves analytics errors for the page to handle", async () => {
    const error = new CoreApiRequestError("Invalid date range", {
      status: 422,
    });
    core.getProjectsByIdNewsletterAnalytics.mockRejectedValue(error);
    await expect(
      newsletterService.getAnalytics(NEWSLETTER_ISSUE.projectId, {}),
    ).rejects.toBe(error);
    core.getProjectsByIdNewsletterIssuesByIssueIdAnalytics.mockRejectedValue(
      error,
    );
    await expect(
      newsletterService.getIssueAnalytics(
        NEWSLETTER_ISSUE.projectId,
        NEWSLETTER_ISSUE.id,
      ),
    ).rejects.toBe(error);
  });
  it.each(["x-vercel-forwarded-for", "x-forwarded-for"])(
    "forwards signup inputs and visitor IP for Core rate limiting: %s",
    async (header) => {
      requestHeaders.mockResolvedValue(
        new Headers({ [header]: "203.0.113.4", cookie: "private-session" }),
      );
      const accepted = { status: "check_your_inbox" } as const;
      core.postPublicNewslettersByPublicSlugSubscribe.mockResolvedValue(
        accepted,
      );
      const input = {
        email: "reader@example.com",
        locale: "es",
        source: "SIGNUP_FORM",
      } as const;
      expect(
        await newsletterService.subscribe(PUBLIC_NEWSLETTER_SLUG, input),
      ).toBe(accepted);
      expect(
        core.postPublicNewslettersByPublicSlugSubscribe,
      ).toHaveBeenCalledExactlyOnceWith(PUBLIC_NEWSLETTER_SLUG, input, {
        "x-vercel-forwarded-for": "203.0.113.4",
        "x-forwarded-for": "203.0.113.4",
      });
    },
  );

  it("prefers the platform visitor address and does not invent an IP", async () => {
    core.postPublicNewslettersByPublicSlugSubscribe.mockResolvedValue({
      status: "check_your_inbox",
    });
    const input = { email: "reader@example.com", locale: "en" } as const;
    requestHeaders.mockResolvedValue(
      new Headers({
        "x-vercel-forwarded-for": "203.0.113.4",
        "x-forwarded-for": "198.51.100.3",
      }),
    );
    await newsletterService.subscribe(PUBLIC_NEWSLETTER_SLUG, input);
    expect(
      core.postPublicNewslettersByPublicSlugSubscribe,
    ).toHaveBeenLastCalledWith(PUBLIC_NEWSLETTER_SLUG, input, {
      "x-vercel-forwarded-for": "203.0.113.4",
      "x-forwarded-for": "203.0.113.4",
    });
    requestHeaders.mockResolvedValue(new Headers());
    await newsletterService.subscribe(PUBLIC_NEWSLETTER_SLUG, input);
    expect(
      core.postPublicNewslettersByPublicSlugSubscribe,
    ).toHaveBeenLastCalledWith(PUBLIC_NEWSLETTER_SLUG, input, {});
  });

  it("preserves signup errors for the public action", async () => {
    const error = new CoreApiRequestError("Rate limited", { status: 429 });
    core.postPublicNewslettersByPublicSlugSubscribe.mockRejectedValue(error);
    await expect(
      newsletterService.subscribe(PUBLIC_NEWSLETTER_SLUG, {
        email: "reader@example.com",
        locale: "en",
      }),
    ).rejects.toBe(error);
  });
  it("loads public newsletter info, cursor pages and localized issue HTML through Core", async () => {
    core.getPublicNewslettersByPublicSlug.mockResolvedValue({
      data: PUBLIC_NEWSLETTER,
    });
    expect(
      await newsletterService.getPublicNewsletter(PUBLIC_NEWSLETTER_SLUG),
    ).toBe(PUBLIC_NEWSLETTER);
    expect(core.getPublicNewslettersByPublicSlug).toHaveBeenCalledWith(
      PUBLIC_NEWSLETTER_SLUG,
    );
    const response = {
      data: [PUBLIC_NEWSLETTER_ISSUE_SUMMARY],
      meta: { pagination: { nextCursor: "next" } },
    };
    core.getPublicNewslettersByPublicSlugIssues.mockResolvedValue(response);
    expect(
      await newsletterService.listPublicIssues(PUBLIC_NEWSLETTER_SLUG, {
        cursor: "previous",
      }),
    ).toBe(response);
    expect(core.getPublicNewslettersByPublicSlugIssues).toHaveBeenCalledWith(
      PUBLIC_NEWSLETTER_SLUG,
      { cursor: "previous" },
    );
    core.getPublicNewslettersByPublicSlugIssuesByIssueSlug.mockResolvedValue({
      data: PUBLIC_NEWSLETTER_ISSUE,
    });
    expect(
      await newsletterService.getPublicIssue(
        PUBLIC_NEWSLETTER_SLUG,
        "issue",
        "de",
      ),
    ).toBe(PUBLIC_NEWSLETTER_ISSUE);
    expect(
      core.getPublicNewslettersByPublicSlugIssuesByIssueSlug,
    ).toHaveBeenCalledWith(PUBLIC_NEWSLETTER_SLUG, "issue", "de");
    await newsletterService.getPublicIssue(
      PUBLIC_NEWSLETTER_SLUG,
      "issue",
      "invalid",
    );
    expect(
      core.getPublicNewslettersByPublicSlugIssuesByIssueSlug,
    ).toHaveBeenLastCalledWith(PUBLIC_NEWSLETTER_SLUG, "issue", "en");
  });

  it.each([404, 503])(
    "maps public 404s to null and propagates other errors: %s",
    async (status) => {
      const error = new CoreApiRequestError("Unavailable", { status });
      core.getPublicNewslettersByPublicSlug.mockRejectedValue(error);
      core.getPublicNewslettersByPublicSlugIssues.mockRejectedValue(error);
      core.getPublicNewslettersByPublicSlugIssuesByIssueSlug.mockRejectedValue(
        error,
      );
      const reads = [
        newsletterService.getPublicNewsletter("missing"),
        newsletterService.listPublicIssues("missing", {}),
        newsletterService.getPublicIssue("missing", "issue", "en"),
      ];
      for (const read of reads) {
        if (status === 404) expect(await read).toBeNull();
        else await expect(read).rejects.toBe(error);
      }
    },
  );
  it("preserves issue DTOs and cursor metadata from Core", async () => {
    const response = {
      data: [NEWSLETTER_ISSUE],
      meta: { pagination: { nextCursor: "i2" } },
    };
    core.getProjectsByIdNewsletterIssues.mockResolvedValue(response);
    const query = { limit: 25, cursor: "i1" };
    expect(await newsletterService.listIssues("p1", query)).toBe(response);
    expect(core.getProjectsByIdNewsletterIssues).toHaveBeenCalledWith(
      "p1",
      query,
    );
    core.getProjectsByIdNewsletterIssuesByIssueId.mockResolvedValue({
      data: NEWSLETTER_ISSUE,
    });
    expect(await newsletterService.getIssue("p1", "i1")).toBe(NEWSLETTER_ISSUE);
    expect(core.getProjectsByIdNewsletterIssuesByIssueId).toHaveBeenCalledWith(
      "p1",
      "i1",
    );
    core.getProjectsByIdNewsletterIssuesByIssueId.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    expect(await newsletterService.getIssue("p1", "i1")).toBeNull();
  });

  it("forwards issue create, revision save, delete, and preview operations", async () => {
    const input = { subject: "News", template: "TEXT", content: [] } as const;
    const values = { ...input, content: [] };
    core.postProjectsByIdNewsletterIssues.mockResolvedValue({
      data: NEWSLETTER_ISSUE,
    });
    core.patchProjectsByIdNewsletterIssuesByIssueId.mockResolvedValue({
      data: NEWSLETTER_ISSUE,
    });
    core.postProjectsByIdNewsletterIssuesPreview.mockResolvedValue({
      data: { html: "<p>News</p>" },
    });
    expect(await newsletterService.createIssue("p1", values)).toBe(
      NEWSLETTER_ISSUE,
    );
    expect(core.postProjectsByIdNewsletterIssues).toHaveBeenCalledWith(
      "p1",
      values,
    );
    expect(
      await newsletterService.saveIssue("p1", "i1", { ...values, revision: 2 }),
    ).toBe(NEWSLETTER_ISSUE);
    expect(
      core.patchProjectsByIdNewsletterIssuesByIssueId,
    ).toHaveBeenCalledWith("p1", "i1", { ...values, revision: 2 });
    await newsletterService.deleteIssue("p1", "i1");
    expect(
      core.deleteProjectsByIdNewsletterIssuesByIssueId,
    ).toHaveBeenCalledWith("p1", "i1");
    expect(await newsletterService.previewIssue("p1", values)).toEqual({
      html: "<p>News</p>",
    });
    expect(core.postProjectsByIdNewsletterIssuesPreview).toHaveBeenCalledWith(
      "p1",
      values,
    );
  });

  it("propagates issue read and mutation failures", async () => {
    const error = new CoreApiRequestError("Unavailable", { status: 503 });
    for (const operation of [
      core.getProjectsByIdNewsletterIssues,
      core.getProjectsByIdNewsletterIssuesByIssueId,
      core.postProjectsByIdNewsletterIssues,
      core.patchProjectsByIdNewsletterIssuesByIssueId,
      core.deleteProjectsByIdNewsletterIssuesByIssueId,
      core.postProjectsByIdNewsletterIssuesPreview,
    ])
      operation.mockRejectedValue(error);
    const input = { subject: "News", template: "TEXT", content: [] } as const;
    const values = { ...input, content: [] };
    await expect(newsletterService.listIssues("p1", {})).rejects.toBe(error);
    await expect(newsletterService.getIssue("p1", "i1")).rejects.toBe(error);
    await expect(newsletterService.createIssue("p1", values)).rejects.toBe(
      error,
    );
    await expect(
      newsletterService.saveIssue("p1", "i1", { ...values, revision: 2 }),
    ).rejects.toBe(error);
    await expect(newsletterService.deleteIssue("p1", "i1")).rejects.toBe(error);
    await expect(newsletterService.previewIssue("p1", values)).rejects.toBe(
      error,
    );
  });
  it.each([true, false])("reads enabled=%s from Core", async (enabled) => {
    core.getNewsletterAvailability.mockResolvedValue({ data: { enabled } });
    expect(await newsletterService.isEnabled()).toBe(enabled);
  });

  it("propagates availability failures", async () => {
    core.getNewsletterAvailability.mockRejectedValue(new Error("Core down"));
    await expect(newsletterService.isEnabled()).rejects.toThrow("Core down");
  });

  it("returns no settings only for a missing newsletter", async () => {
    core.getProjectsByIdNewsletter.mockRejectedValue(
      new CoreApiRequestError("Missing", { status: 404 }),
    );
    expect(await newsletterService.getSettings("p1")).toBeNull();
    expect(core.getProjectsByIdNewsletter).toHaveBeenCalledWith("p1");
  });

  it.each([403, 500])(
    "propagates a %i instead of showing a setup form",
    async (status) => {
      const error = new CoreApiRequestError("Failed", { status });
      core.getProjectsByIdNewsletter.mockRejectedValue(error);
      await expect(newsletterService.getSettings("p1")).rejects.toBe(error);
    },
  );

  it("returns Core settings directly", async () => {
    const settings = { id: "n1" };
    core.getProjectsByIdNewsletter.mockResolvedValue({ data: settings });
    expect(await newsletterService.getSettings("p1")).toBe(settings);
  });

  it("saves through Core and returns the saved settings", async () => {
    const input = {
      name: "Weekly",
      senderName: "Team",
      replyTo: "team@example.com",
      brand: {},
      welcomeEmailEnabled: false,
    };
    const settings = { ...input, publicSlug: "weekly-123" };
    core.putProjectsByIdNewsletter.mockResolvedValue({ data: settings });
    expect(await newsletterService.saveSettings("p1", input)).toBe(settings);
    expect(core.putProjectsByIdNewsletter).toHaveBeenCalledWith("p1", input);
  });

  it("propagates save failures", async () => {
    core.putProjectsByIdNewsletter.mockRejectedValue(new Error("Save failed"));
    await expect(
      newsletterService.saveSettings("p1", {
        name: "Weekly",
        senderName: "Team",
        replyTo: "team@example.com",
        brand: {},
        welcomeEmailEnabled: false,
      }),
    ).rejects.toThrow("Save failed");
  });

  it("preserves subscriber counts and cursor metadata from Core", async () => {
    const response = {
      data: { subscribers: [], counts: { ACTIVE: 2 } },
      meta: { pagination: { nextCursor: "s2" } },
    };
    const query = {
      limit: 25,
      cursor: "s1",
      status: "ACTIVE",
      search: "example",
    } as const;
    core.getProjectsByIdNewsletterSubscribers.mockResolvedValue(response);
    expect(await newsletterService.listSubscribers("p1", query)).toBe(response);
    expect(core.getProjectsByIdNewsletterSubscribers).toHaveBeenCalledWith(
      "p1",
      query,
    );
  });

  it("forwards subscriber mutations to generated Core operations", async () => {
    const subscriber = { id: "s1" };
    const input = { email: "one@example.com", consent: "CONFIRMED" } as const;
    core.postProjectsByIdNewsletterSubscribers.mockResolvedValue({
      data: subscriber,
    });
    expect(await newsletterService.addSubscriber("p1", input)).toBe(subscriber);
    expect(core.postProjectsByIdNewsletterSubscribers).toHaveBeenCalledWith(
      "p1",
      input,
    );
    const summary = { imported: 1, skippedExisting: 0, invalid: [] };
    const csv = {
      csv: "email\none@example.com",
      consent: "CONFIRMED",
    } as const;
    core.postProjectsByIdNewsletterSubscribersImport.mockResolvedValue({
      data: summary,
    });
    expect(await newsletterService.importSubscribers("p1", csv)).toBe(summary);
    expect(
      core.postProjectsByIdNewsletterSubscribersImport,
    ).toHaveBeenCalledWith("p1", csv);
    core.patchProjectsByIdNewsletterSubscribersBySubscriberId.mockResolvedValue(
      { data: subscriber },
    );
    expect(
      await newsletterService.updateSubscriber("p1", "s1", {
        status: "UNSUBSCRIBED",
      }),
    ).toBe(subscriber);
    expect(
      core.patchProjectsByIdNewsletterSubscribersBySubscriberId,
    ).toHaveBeenCalledWith("p1", "s1", { status: "UNSUBSCRIBED" });
    await newsletterService.removeSubscriber("p1", "s1");
    expect(
      core.deleteProjectsByIdNewsletterSubscribersBySubscriberId,
    ).toHaveBeenCalledWith("p1", "s1");
  });

  it("propagates subscriber read and mutation failures", async () => {
    const error = new CoreApiRequestError("Forbidden", { status: 403 });
    for (const method of [
      core.getProjectsByIdNewsletterSubscribers,
      core.postProjectsByIdNewsletterSubscribers,
      core.postProjectsByIdNewsletterSubscribersImport,
      core.patchProjectsByIdNewsletterSubscribersBySubscriberId,
      core.deleteProjectsByIdNewsletterSubscribersBySubscriberId,
    ])
      method.mockRejectedValue(error);
    await expect(newsletterService.listSubscribers("p1", {})).rejects.toBe(
      error,
    );
    await expect(
      newsletterService.addSubscriber("p1", {
        email: "one@example.com",
        consent: "CONFIRMED",
      }),
    ).rejects.toBe(error);
    await expect(
      newsletterService.importSubscribers("p1", {
        csv: "email",
        consent: "CONFIRMED",
      }),
    ).rejects.toBe(error);
    await expect(
      newsletterService.updateSubscriber("p1", "s1", { status: "ACTIVE" }),
    ).rejects.toBe(error);
    await expect(newsletterService.removeSubscriber("p1", "s1")).rejects.toBe(
      error,
    );
  });
});
