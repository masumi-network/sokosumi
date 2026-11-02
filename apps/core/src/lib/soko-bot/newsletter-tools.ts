import type { NewsletterIssue, Prisma } from "@sokosumi/database";
import {
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { newsletterSignupLinks } from "@sokosumi/utils";

import { getWebAppBaseUrl } from "@/config/env";
import {
  createNewsletterIssueRequestSchema,
  newsletterIssueSchema,
  newsletterSchema,
  newsletterSubscriberSchema,
  patchNewsletterIssueRequestSchema,
} from "@/schemas/newsletter.schema";
import {
  newsletterAnalyticsQuerySchema,
  newsletterAnalyticsSchema,
  newsletterIssueAnalyticsSchema,
} from "@/schemas/newsletter-analytics.schema";
import {
  countNewsletterSubscribers,
  getNewsletter,
  listNewsletterSubscribers,
  type NewsletterScope,
} from "@/services/newsletter.service";
import {
  getNewsletterAnalytics,
  getNewsletterIssueAnalytics,
} from "@/services/newsletter-analytics.service";
import {
  createNewsletterIssue,
  deleteNewsletterIssue,
  getNewsletterIssue,
  listNewsletterIssues,
  patchNewsletterIssue,
} from "@/services/newsletter-issues.service";

type NewsletterReadCapability = Extract<
  SokoBotCapability,
  | "get_newsletter"
  | "list_newsletter_issues"
  | "get_newsletter_issue"
  | "get_newsletter_analytics"
  | "list_newsletter_subscribers"
>;

type NewsletterWriteCapability = Extract<
  SokoBotCapability,
  | "create_newsletter_issue"
  | "update_newsletter_issue"
  | "delete_newsletter_issue"
>;

const settingsSchema = newsletterSchema.pick({
  id: true,
  projectId: true,
  name: true,
  senderName: true,
  replyTo: true,
  brand: true,
  welcomeEmailEnabled: true,
  welcomeSubject: true,
  welcomeBody: true,
  publicSlug: true,
});

const issueSummarySchema = newsletterIssueSchema.pick({
  id: true,
  subject: true,
  status: true,
  scheduledAt: true,
  sentAt: true,
  revision: true,
  approvedByName: true,
  createdAt: true,
});

const issueDetailSchema = newsletterIssueSchema.omit({
  newsletterId: true,
  workspaceId: true,
  approvedByUserId: true,
});

const subscriberSchema = newsletterSubscriberSchema.pick({
  id: true,
  email: true,
  name: true,
  contact: true,
  status: true,
  source: true,
  confirmedAt: true,
  unsubscribedAt: true,
  createdAt: true,
});

function createdBy(issue: NewsletterIssue) {
  if (issue.creatorSokoBotId)
    return { kind: "soko_bot", id: issue.creatorSokoBotId } as const;
  if (issue.creatorCoworkerId)
    return { kind: "coworker", id: issue.creatorCoworkerId } as const;
  if (issue.creatorUserId)
    return { kind: "user", id: issue.creatorUserId } as const;
  return null;
}

/**
 * What the issue's status allows next. Approving, scheduling, sending and
 * unscheduling are a person's, in the Newsletter UI; the rest are open to
 * whoever has a tool for them.
 */
export function newsletterIssueActions(
  issue: Pick<NewsletterIssue, "status" | "approvedAt">,
) {
  switch (issue.status) {
    case "DRAFT":
      return {
        actions: ["edit", "submit_for_approval", "delete"],
        humanOnlyActions: [],
      };
    case "NEEDS_APPROVAL":
      return {
        actions: ["edit"],
        humanOnlyActions: issue.approvedAt
          ? ["schedule", "send_now"]
          : ["approve"],
      };
    case "SCHEDULED":
      return { actions: [], humanOnlyActions: ["unschedule"] };
    case "CANCELED":
      return { actions: ["delete"], humanOnlyActions: [] };
    default:
      return { actions: [], humanOnlyActions: [] };
  }
}

function issueUrl(issue: Pick<NewsletterIssue, "id" | "projectId">) {
  return `/newsletter/issues/${encodeURIComponent(issue.id)}?projectId=${encodeURIComponent(issue.projectId)}`;
}

/** What a write hands back: enough to link the issue and edit it again. */
function writtenIssue(issue: NewsletterIssue) {
  return {
    ...newsletterIssueSchema
      .pick({
        id: true,
        projectId: true,
        subject: true,
        status: true,
        revision: true,
      })
      .parse(issue),
    url: issueUrl(issue),
  };
}

/**
 * Runs a newsletter write in the caller's transaction, in a scope it has
 * already authorized. Input passes the Newsletter UI's own request schemas,
 * and the issue service keeps its lifecycle rules: edits only before
 * scheduling, each one back to DRAFT without approval, deletes only of
 * drafts and canceled issues.
 */
export async function runNewsletterWriteTool(
  capability: NewsletterWriteCapability,
  rawInput: unknown,
  scope: NewsletterScope,
  {
    client,
    creatorSokoBotId,
  }: { client: Prisma.TransactionClient; creatorSokoBotId: string },
) {
  switch (capability) {
    case "create_newsletter_issue": {
      const { projectId: _projectId, ...input } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.create_newsletter_issue.parse(rawInput);
      return writtenIssue(
        await createNewsletterIssue(
          scope,
          createNewsletterIssueRequestSchema.parse(input),
          { client, creatorSokoBotId },
        ),
      );
    }
    case "update_newsletter_issue": {
      const {
        projectId: _projectId,
        issueId,
        ...input
      } = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_newsletter_issue.parse(rawInput);
      return writtenIssue(
        await patchNewsletterIssue(
          scope,
          issueId,
          patchNewsletterIssueRequestSchema.parse(input),
          client,
        ),
      );
    }
    case "delete_newsletter_issue": {
      const { issueId, revision } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.delete_newsletter_issue.parse(rawInput);
      await deleteNewsletterIssue(scope, issueId, { revision, client });
      return {
        id: issueId,
        projectId: scope.projectId,
        revision,
        deleted: true,
      };
    }
  }
}

/** Runs a newsletter read in a scope the caller has already authorized. */
export async function runNewsletterReadTool(
  capability: NewsletterReadCapability,
  rawInput: unknown,
  scope: NewsletterScope,
): Promise<unknown> {
  switch (capability) {
    case "get_newsletter": {
      SOKO_BOT_TOOL_INPUT_SCHEMAS.get_newsletter.parse(rawInput);
      const newsletter = await getNewsletter(scope);
      return {
        ...settingsSchema.parse(newsletter),
        ...newsletterSignupLinks(
          newsletter.publicSlug,
          getWebAppBaseUrl(),
          "Newsletter signup",
        ),
        subscriberCounts: await countNewsletterSubscribers(newsletter.id),
      };
    }
    case "list_newsletter_issues": {
      const { projectId: _projectId, ...query } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.list_newsletter_issues.parse(rawInput);
      const result = await listNewsletterIssues(scope, query);
      return {
        issues: result.issues.map((issue) => ({
          ...issueSummarySchema.parse(issue),
          createdBy: createdBy(issue),
        })),
        pagination: result.pagination,
      };
    }
    case "get_newsletter_issue": {
      const { issueId } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.get_newsletter_issue.parse(rawInput);
      const issue = await getNewsletterIssue(scope, issueId);
      return {
        ...issueDetailSchema.parse(issue),
        createdBy: createdBy(issue),
        ...newsletterIssueActions(issue),
        url: issueUrl(issue),
      };
    }
    case "get_newsletter_analytics": {
      const {
        projectId: _projectId,
        issueId,
        ...query
      } = SOKO_BOT_TOOL_INPUT_SCHEMAS.get_newsletter_analytics.parse(rawInput);
      if (issueId)
        return newsletterIssueAnalyticsSchema.parse(
          await getNewsletterIssueAnalytics(scope, issueId),
        );
      return newsletterAnalyticsSchema.parse(
        await getNewsletterAnalytics(
          scope,
          newsletterAnalyticsQuerySchema.parse(query),
        ),
      );
    }
    case "list_newsletter_subscribers": {
      const { projectId: _projectId, ...query } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.list_newsletter_subscribers.parse(rawInput);
      const result = await listNewsletterSubscribers(scope, query);
      return {
        subscribers: result.subscribers.map((subscriber) =>
          subscriberSchema.parse(subscriber),
        ),
        counts: result.counts,
        pagination: result.pagination,
      };
    }
  }
}
