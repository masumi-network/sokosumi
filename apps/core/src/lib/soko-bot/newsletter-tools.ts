import type { NewsletterIssue, Prisma } from "@sokosumi/database";
import {
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { type NewsletterBlock, newsletterSignupLinks } from "@sokosumi/utils";

import { getWebAppBaseUrl } from "@/config/env";
import { conflict } from "@/helpers/error";
import {
  createNewsletterIssueRequestSchema,
  newsletterBrandSchema,
  newsletterIssueSchema,
  newsletterSchema,
  newsletterSubscriberSchema,
  patchNewsletterIssueRequestSchema,
  putNewsletterRequestSchema,
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
  putNewsletter,
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
  type NewsletterTaskContext,
  patchNewsletterIssue,
  renderNewsletterIssuePreview,
  submitNewsletterIssue,
} from "@/services/newsletter-issues.service";

type NewsletterReadCapability = Extract<
  SokoBotCapability,
  | "get_newsletter"
  | "list_newsletter_issues"
  | "get_newsletter_issue"
  | "get_newsletter_analytics"
  | "list_newsletter_subscribers"
  | "preview_newsletter_issue"
>;

type NewsletterWriteCapability = Extract<
  SokoBotCapability,
  | "create_newsletter_issue"
  | "update_newsletter_issue"
  | "delete_newsletter_issue"
  | "submit_newsletter_issue"
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

/** Enough plain text for a model to proofread without the full HTML. */
const PREVIEW_TEXT_MAX_CHARS = 8_000;
/** Gmail hides the rest of a message behind "View entire message" past this. */
const GMAIL_CLIP_BYTES = 102 * 1024;

/** Cheap checks on what the renderer would quietly drop or degrade. */
function previewWarnings(
  issue: { previewText?: string | null; content: NewsletterBlock[] },
  htmlBytes: number,
) {
  const warnings: string[] = [];
  if (!issue.content.length) warnings.push("The issue has no content blocks");
  if (!issue.previewText)
    warnings.push("No preview text: inboxes show the subject as the snippet");
  issue.content.forEach((block, index) => {
    const at = `Block ${index + 1} (${block.type})`;
    if (
      (block.type === "heading" || block.type === "text") &&
      !block.text.trim()
    )
      warnings.push(`${at} is empty`);
    if (block.type === "image" && !block.alt.trim())
      warnings.push(`${at} has no alt text`);
    // Inline links render only for https; anything else stays literal text.
    if (block.type === "text" && /\]\((?!https:\/\/)[^)\s]*\)/.test(block.text))
      warnings.push(`${at} has a link that is not https and will show as text`);
  });
  if (htmlBytes > GMAIL_CLIP_BYTES)
    warnings.push(
      `The email is ${Math.round(htmlBytes / 1024)} KB; Gmail clips messages over 102 KB`,
    );
  return warnings;
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
    taskContext,
  }: {
    client: Prisma.TransactionClient;
    creatorSokoBotId: string;
    /** Who submits for approval; loaded only when an issue is submitted. */
    taskContext: () => Promise<NewsletterTaskContext>;
  },
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
    case "submit_newsletter_issue": {
      const { issueId, revision } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.submit_newsletter_issue.parse(rawInput);
      const { status } = await getNewsletterIssue(scope, issueId, client);
      if (status !== "DRAFT")
        throw conflict(
          `Only draft issues can be submitted for approval; this one is ${status}`,
        );
      // The same submit as the UI's: NEEDS_APPROVAL and a human approval Task.
      return writtenIssue(
        await submitNewsletterIssue(
          scope,
          issueId,
          revision,
          await taskContext(),
          client,
        ),
      );
    }
  }
}

/**
 * Settings that change what every future email says, or (an enabled welcome
 * email) send mail by themselves to each new subscriber.
 */
const OWNER_ONLY_NEWSLETTER_SETTINGS = [
  "senderName",
  "replyTo",
  "welcomeEmailEnabled",
  "welcomeSubject",
  "welcomeBody",
] as const;

/** Whether a settings change needs the owner's word in chat this turn. */
export function newsletterSettingsNeedOwner(rawInput: unknown) {
  const input =
    SOKO_BOT_TOOL_INPUT_SCHEMAS.update_newsletter_settings.parse(rawInput);
  return OWNER_ONLY_NEWSLETTER_SETTINGS.some(
    (field) => input[field] !== undefined,
  );
}

/**
 * Changes only the given settings. The settings page saves them whole, so
 * this reads the newsletter in the caller's transaction, merges, and saves
 * the result through the page's own schema and service.
 */
export async function updateNewsletterSettings(
  rawInput: unknown,
  scope: NewsletterScope,
  client: Prisma.TransactionClient,
) {
  const {
    projectId: _projectId,
    brand = {},
    ...settings
  } = SOKO_BOT_TOOL_INPUT_SCHEMAS.update_newsletter_settings.parse(rawInput);
  const changed = Object.fromEntries(
    Object.entries(settings).filter(([, field]) => field !== undefined),
  );
  const current = await getNewsletter(scope, client);
  const mergedBrand = {
    ...newsletterBrandSchema.parse(current.brand),
    ...brand,
  };
  const saved = await putNewsletter(
    scope,
    putNewsletterRequestSchema.parse({
      name: current.name,
      senderName: current.senderName,
      replyTo: current.replyTo,
      welcomeEmailEnabled: current.welcomeEmailEnabled,
      welcomeSubject: current.welcomeSubject,
      welcomeBody: current.welcomeBody,
      ...changed,
      // null removes a brand field.
      brand: Object.fromEntries(
        Object.entries(mergedBrand).filter(([, field]) => field != null),
      ),
    }),
    client,
  );
  return {
    id: saved.id,
    projectId: saved.projectId,
    updated: [
      ...Object.keys(changed),
      ...Object.keys(brand).map((field) => `brand.${field}`),
    ],
    updatedAt: saved.updatedAt.toISOString(),
    url: `/projects/${saved.projectId}/newsletter`,
  };
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
    case "preview_newsletter_issue": {
      const {
        projectId: _projectId,
        issueId,
        ...unsaved
      } = SOKO_BOT_TOOL_INPUT_SCHEMAS.preview_newsletter_issue.parse(rawInput);
      const saved = issueId ? await getNewsletterIssue(scope, issueId) : null;
      const issue = createNewsletterIssueRequestSchema.parse(
        saved
          ? {
              subject: saved.subject,
              previewText: saved.previewText,
              template: saved.template,
              content: saved.content,
            }
          : unsaved,
      );
      const { html, text } = await renderNewsletterIssuePreview(scope, issue);
      const htmlBytes = Buffer.byteLength(html);
      return {
        ...(saved
          ? {
              issueId: saved.id,
              status: saved.status,
              revision: saved.revision,
            }
          : {}),
        subject: issue.subject,
        previewText: issue.previewText ?? null,
        text: text.slice(0, PREVIEW_TEXT_MAX_CHARS),
        textTruncated: text.length > PREVIEW_TEXT_MAX_CHARS,
        htmlBytes,
        warnings: previewWarnings(issue, htmlBytes),
        // Unsaved content has no editor page yet; the issue list is where it would land.
        url: saved
          ? issueUrl(saved)
          : `/newsletter/issues?projectId=${encodeURIComponent(scope.projectId)}`,
      };
    }
  }
}
