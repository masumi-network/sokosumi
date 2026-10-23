import type {
  NewsletterIssue,
  PublicNewsletter,
  PublicNewsletterIssue,
  PublicNewsletterIssueSummary,
} from "@sokosumi/core-client";

export const NEWSLETTER_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const NEWSLETTER_ISSUE: NewsletterIssue = {
  id: "44444444-4444-4444-8444-444444444444",
  newsletterId: "33333333-3333-4333-8333-333333333333",
  projectId: NEWSLETTER_PROJECT_ID,
  workspaceId: "22222222-2222-4222-8222-222222222222",
  subject: "Weekly news",
  previewText: "This week's highlights",
  template: "TEXT",
  content: [
    { type: "heading", text: "Hello readers", level: 1 },
    { type: "text", text: "Our latest update" },
    { type: "divider" },
  ],
  status: "DRAFT",
  publicSlug: "weekly-news-1234abcd",
  revision: 2,
  scheduledAt: null,
  sentAt: null,
  timezone: null,
  approvedByUserId: null,
  approvedAt: null,
  taskId: null,
  lastError: null,
  createdAt: new Date("2026-10-23T10:00:00Z"),
  updatedAt: new Date("2026-10-23T10:00:00Z"),
};

export const PUBLIC_NEWSLETTER_SLUG = "project-news-1234abcd";
export const PUBLIC_NEWSLETTER: PublicNewsletter = {
  name: "Project news",
  senderName: "Ada",
  brand: {
    logoUrl: "https://example.com/logo.png",
  },
};
export const PUBLIC_NEWSLETTER_ISSUE: PublicNewsletterIssue = {
  subject: NEWSLETTER_ISSUE.subject,
  previewText: NEWSLETTER_ISSUE.previewText,
  sentAt: new Date("2026-10-23T10:00:00Z"),
  html: "<html><body><p>Our latest update</p></body></html>",
};
export const PUBLIC_NEWSLETTER_ISSUE_SUMMARY: PublicNewsletterIssueSummary = {
  publicSlug: NEWSLETTER_ISSUE.publicSlug,
  subject: PUBLIC_NEWSLETTER_ISSUE.subject,
  previewText: PUBLIC_NEWSLETTER_ISSUE.previewText,
  sentAt: PUBLIC_NEWSLETTER_ISSUE.sentAt,
};
