import { beforeEach, describe, expect, it, vi } from "vitest";

const loadOverview = vi.fn();
const getNewsletterAvailability = vi.fn();
const getProjectsByIdNewsletter = vi.fn();
const getProjectsByIdNewsletterIssues = vi.fn();
const getProjectsByIdNewsletterIssuesByIssueId = vi.fn();
const getProjectsByIdNewsletterSubscribers = vi.fn();
const postProjectsByIdNewsletterIssuesByIssueIdSchedule = vi.fn();
const postProjectsByIdNewsletterIssuesPreview = vi.fn();
const postProjectsByIdNewsletterSubscribersFromContacts = vi.fn();
vi.mock("./cmo-actions", () => ({ loadOverview }));
vi.mock("../lib/core", () => ({
  coreForCurrentUser: async () => ({
    client: {},
    headers: { authorization: "Bearer t" },
  }),
}));
vi.mock("@sokosumi/core-client", () => ({
  getNewsletterAvailability,
  getProjectsByIdNewsletter,
  getProjectsByIdNewsletterIssues,
  getProjectsByIdNewsletterIssuesByIssueId,
  getProjectsByIdNewsletterSubscribers,
  postProjectsByIdNewsletterIssuesByIssueIdSchedule,
  postProjectsByIdNewsletterIssuesPreview,
  postProjectsByIdNewsletterSubscribersFromContacts,
}));

const {
  changeNewsletterIssue,
  loadCalendarDrafts,
  loadNewsletter,
  previewNewsletterIssue,
  subscribeNewsletterContacts,
} = await import("./newsletter-actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CMO newsletter", () => {
  const project = {
    headers: { authorization: "Bearer t", "x-organization-slug": "acme" },
    path: { id: "project-1" },
  };

  beforeEach(() => {
    loadOverview.mockResolvedValue({
      projectId: "project-1",
      organizationSlug: "acme",
    });
  });

  it("distinguishes pilot access from a project that still needs setup", async () => {
    getNewsletterAvailability
      .mockResolvedValueOnce({ data: { data: { enabled: false } } })
      .mockResolvedValueOnce({ data: { data: { enabled: true } } });
    getProjectsByIdNewsletter.mockResolvedValue({ response: { status: 404 } });

    expect(await loadNewsletter("project-1")).toEqual({ state: "disabled" });
    expect(getProjectsByIdNewsletter).not.toHaveBeenCalled();

    expect(await loadNewsletter("project-1")).toEqual({ state: "setup" });
    expect(getProjectsByIdNewsletter).toHaveBeenCalledWith(
      expect.objectContaining(project),
    );
    expect(getProjectsByIdNewsletterIssues).not.toHaveBeenCalled();
  });

  it("loads older eligible drafts without paging through sent issues", async () => {
    getProjectsByIdNewsletterIssues.mockResolvedValueOnce({
      data: {
        data: [{ id: "older-draft", subject: "Already written" }],
        meta: { pagination: { nextCursor: null } },
      },
    });

    expect(
      await loadCalendarDrafts("project-1", { draft: "cursor", review: null }),
    ).toEqual({
      issues: [{ id: "older-draft", subject: "Already written" }],
      next: { draft: null, review: null },
    });
    expect(getProjectsByIdNewsletterIssues).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ...project,
        query: { status: "DRAFT", cursor: "cursor", limit: 20 },
      }),
    );
  });

  it("passes explicit consent and the selected Contacts list to the current project", async () => {
    const result = { added: 2, pendingConfirmation: 2, skippedUnsubscribed: 1 };
    postProjectsByIdNewsletterSubscribersFromContacts.mockResolvedValue({
      data: { data: result },
    });

    expect(
      await subscribeNewsletterContacts("project-1", "list-1", ""),
    ).toEqual({
      error: "Choose how to confirm consent.",
    });
    await expect(
      subscribeNewsletterContacts("stale-project", "list-1", "CONFIRMED"),
    ).rejects.toThrow("active business");
    expect(
      postProjectsByIdNewsletterSubscribersFromContacts,
    ).not.toHaveBeenCalled();

    expect(
      await subscribeNewsletterContacts("project-1", "list-1", "ASK"),
    ).toEqual({ result });
    expect(
      postProjectsByIdNewsletterSubscribersFromContacts,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ...project,
        body: { listIds: ["list-1"], consent: "ASK" },
      }),
    );
  });

  it("previews the saved issue and schedules only the displayed revision", async () => {
    const content = [{ type: "text", text: "Welcome" }];
    getProjectsByIdNewsletterIssuesByIssueId.mockResolvedValue({
      data: {
        data: {
          subject: "October",
          template: "TEXT",
          previewText: null,
          content,
          revision: 3,
        },
      },
    });
    postProjectsByIdNewsletterIssuesPreview.mockResolvedValue({
      data: { data: { html: "<p>Welcome</p>" } },
    });
    postProjectsByIdNewsletterIssuesByIssueIdSchedule.mockResolvedValue({
      error: { message: "Issue changed" },
    });

    const preview = await previewNewsletterIssue("project-1", "issue-1");
    expect(postProjectsByIdNewsletterIssuesPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        ...project,
        body: {
          subject: "October",
          previewText: null,
          template: "TEXT",
          content,
        },
      }),
    );
    expect(preview.html).toBe("<p>Welcome</p>");

    const scheduledAt = new Date("2026-11-10T09:00:00Z");
    expect(
      await changeNewsletterIssue("project-1", preview.id, preview.revision, {
        action: "schedule",
        scheduledAt,
        timezone: "Europe/Prague",
      }),
    ).toBe("Issue changed");
    expect(
      postProjectsByIdNewsletterIssuesByIssueIdSchedule,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        ...project,
        path: { id: "project-1", issueId: "issue-1" },
        body: { revision: 3, scheduledAt, timezone: "Europe/Prague" },
      }),
    );
  });
});

it("keeps issue metadata available for cancellation when preview rendering fails", async () => {
  loadOverview.mockResolvedValue({
    projectId: "project-1",
    organizationSlug: "acme",
  });
  getProjectsByIdNewsletterIssuesByIssueId.mockResolvedValue({
    data: { data: { subject: "October", status: "SCHEDULED", revision: 3 } },
  });
  postProjectsByIdNewsletterIssuesPreview.mockRejectedValue(
    new Error("Offline"),
  );
  await expect(
    previewNewsletterIssue("project-1", "issue-1"),
  ).resolves.toMatchObject({
    id: "issue-1",
    status: "SCHEDULED",
    revision: 3,
    html: null,
  });
});
