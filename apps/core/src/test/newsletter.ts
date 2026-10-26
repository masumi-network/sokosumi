import type {
  Newsletter,
  NewsletterIssue,
  NewsletterSubscriber,
} from "@sokosumi/database";

export const NEWSLETTER_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const NEWSLETTER_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
export const NEWSLETTER_ID = "33333333-3333-4333-8333-333333333333";
export const NEWSLETTER_ISSUE_ID = "44444444-4444-4444-8444-444444444444";
export const NEWSLETTER_SUBSCRIBER_ID = "55555555-5555-4555-8555-555555555555";
export const NEWSLETTER_NOW = new Date("2026-10-23T10:00:00Z");

export const NEWSLETTER: Newsletter = {
  id: NEWSLETTER_ID,
  projectId: NEWSLETTER_PROJECT_ID,
  workspaceId: NEWSLETTER_WORKSPACE_ID,
  name: "Weekly News",
  senderName: "Ada",
  replyTo: "ada@example.com",
  brand: {},
  welcomeEmailEnabled: false,
  welcomeSubject: null,
  welcomeBody: null,
  publicSlug: "weekly-news-1234abcd",
  createdAt: NEWSLETTER_NOW,
  updatedAt: NEWSLETTER_NOW,
};

export const NEWSLETTER_ISSUE: NewsletterIssue = {
  id: NEWSLETTER_ISSUE_ID,
  newsletterId: NEWSLETTER_ID,
  projectId: NEWSLETTER_PROJECT_ID,
  workspaceId: NEWSLETTER_WORKSPACE_ID,
  subject: "Hello readers",
  previewText: null,
  template: "TEXT",
  content: [{ type: "text", text: "This week's news" }],
  status: "DRAFT",
  publicSlug: "hello-readers-1234abcd",
  revision: 0,
  scheduledAt: null,
  sentAt: null,
  timezone: null,
  taskId: null,
  approvedAt: null,
  approvedByUserId: null,
  creatorUserId: null,
  creatorCoworkerId: null,
  creatorSokoBotId: null,
  leaseToken: null,
  leaseExpiresAt: null,
  lastError: null,
  createdAt: NEWSLETTER_NOW,
  updatedAt: NEWSLETTER_NOW,
};

export const NEWSLETTER_SUBSCRIBER: NewsletterSubscriber = {
  id: NEWSLETTER_SUBSCRIBER_ID,
  newsletterId: NEWSLETTER_ID,
  email: "reader@example.com",
  name: null,
  status: "ACTIVE",
  source: "MANUAL",
  consentAt: NEWSLETTER_NOW,
  confirmedAt: null,
  welcomeSentAt: null,
  welcomeLeaseExpiresAt: null,
  unsubscribedAt: null,
  bouncedAt: null,
  createdAt: NEWSLETTER_NOW,
};
