import type { NewsletterIssue } from "@sokosumi/core-client";

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
