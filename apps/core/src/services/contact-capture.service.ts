/**
 * Automatic contact capture from every Soko Bot's connected mail, calendar
 * and Slack (docs/contacts/design.md, Phase 3).
 *
 * Each integration has a `ContactCaptureState`: per source, a forward
 * position (`since`) read every run, and a backward 12-month backfill read a
 * few pages per run, newest window first. The state is written after every
 * page, so a run that stops (deadline, Composio error, budget) resumes on the
 * page it did not finish. Writing goes through `captureContactInteraction`,
 * idempotent by `sourceRef`, so reading a page twice adds nothing.
 */
import type { Prisma } from "@sokosumi/database";
import { SOKO_BOT_SLACK_CAPTURE_TOOLS } from "@sokosumi/soko-bot";
import { normalizeContactChannelValue } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import {
  type CaptureCandidate,
  type ExtractContext,
  type Extraction,
  extractInboundMail,
  extractMeeting,
  extractSentMail,
  extractSlackConversation,
  parseEvent,
  parseMail,
  parseSlackConversation,
  parseSlackProfile,
  type SlackConversation,
  type SlackProfile,
  slackCandidate,
  slackDays,
} from "@/lib/contacts/capture-extract";
import type { CaptureSkipReason } from "@/lib/contacts/capture-filters";
import {
  judgeRoleInboxes,
  MIN_PERSON_PROBABILITY,
} from "@/lib/contacts/capture-judge";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import {
  type EnrichmentStats,
  emptyEnrichmentStats,
  enrichWorkspaceContacts,
  workspacesWithPendingEnrichment,
} from "@/services/contact-enrichment.service";
import {
  type ImportanceStats,
  judgeWorkspaceImportance,
  refreshContactFamiliarity,
} from "@/services/contact-scores.service";
import {
  type ContactActor,
  captureContactInteraction,
  inContactTransaction,
  mergeContacts,
} from "@/services/contacts.service";
import {
  type ActiveIntegration,
  fetchCalendarPage,
  fetchInboxPage,
  resolveProvider,
  runIntegrationTool,
  SokoBotIntegrationError,
} from "@/services/soko-bot-integrations.service";

const DAY_MS = 24 * 60 * 60 * 1_000;

export const CAPTURE_SOURCES = [
  "mail.sent",
  "mail.received",
  "calendar",
  "slack",
] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/** Providers capture reads, and what it reads from each. */
const PROVIDER_SOURCES: Readonly<Record<string, readonly CaptureSource[]>> = {
  gmail: ["mail.sent", "mail.received"],
  outlook: ["mail.sent", "mail.received", "calendar"],
  googlecalendar: ["calendar"],
  [SOKO_BOT_SLACK_CAPTURE_TOOLS.provider]: ["slack"],
};

/** Gmail's folders for each mail source; Outlook uses its folder argument. */
const GMAIL_QUERY: Record<"mail.sent" | "mail.received", string> = {
  "mail.sent": "in:sent",
  "mail.received":
    "-in:sent -in:chats -in:drafts -in:spam -in:trash -category:promotions -category:social -category:updates -category:forums",
};

export interface CaptureLimits {
  backfillDays: number;
  /** Width of one backfill window; pages run newest first inside it. */
  windowDays: number;
  /** Composio pages per integration per run, all sources together. */
  pagesPerIntegration: number;
  mailPageSize: number;
  eventPageSize: number;
  /** Contact writes per workspace per run. */
  capturesPerWorkspace: number;
  /** Jev calls per workspace per run, for role inboxes. */
  judgeCallsPerWorkspace: number;
  judgeBatch: number;
  enrichmentsPerWorkspace: number;
  enrichmentUsdPerWorkspace: number;
  /** Jev importance judgements per workspace per run. */
  importanceJudgmentsPerWorkspace: number;
  /** Workspaces whose queued contacts are enriched per run. */
  enrichmentWorkspaces: number;
  slackCallsPerRun: number;
  slackHistoryPagesPerConversation: number;
  /** A channel with more members is not a conversation. */
  slackSmallChannel: number;
  slackIntervalMs: number;
  /** Re-read this much before `since`; capture is idempotent. */
  overlapMs: number;
  /** Pause between Composio calls, so a backfill never bursts. */
  callSpacingMs: number;
  /** How long a provider without the needed tools is left alone. */
  unsupportedPauseMs: number;
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = {
  backfillDays: 365,
  windowDays: 30,
  pagesPerIntegration: 6,
  mailPageSize: 50,
  eventPageSize: 100,
  capturesPerWorkspace: 400,
  judgeCallsPerWorkspace: 4,
  judgeBatch: 20,
  enrichmentsPerWorkspace: 40,
  enrichmentUsdPerWorkspace: 0.1,
  importanceJudgmentsPerWorkspace: 40,
  enrichmentWorkspaces: 10,
  slackCallsPerRun: 60,
  slackHistoryPagesPerConversation: 5,
  slackSmallChannel: 8,
  slackIntervalMs: 60 * 60 * 1_000,
  overlapMs: 10 * 60 * 1_000,
  callSpacingMs: 250,
  unsupportedPauseMs: DAY_MS,
};

interface SourceCursor {
  /** Everything after this was read forward. */
  since: string;
  /** The backfill reads before this; `null` once it reached the floor. */
  backfillUntil: string | null;
  /** The page inside the current backfill window still to read. */
  pageToken: string | null;
  /** Slack's forward pass resumes its conversation walk here. */
  forwardToken?: string | null;
  /** Provider lacks a needed tool: left alone until then. */
  pausedUntil?: string;
}

type CaptureCursor = Partial<Record<CaptureSource, SourceCursor>>;

export type SkipCounts = Partial<Record<CaptureSkipReason, number>>;

export interface CaptureStats {
  integrations: number;
  pages: number;
  candidates: number;
  created: number;
  updated: number;
  interactions: number;
  merged: number;
  mergeSuggestions: number;
  judged: number;
  failed: number;
  skipped: SkipCounts;
  backfillsCompleted: number;
  unsupported: string[];
  errors: string[];
}

function emptyStats(): CaptureStats {
  return {
    integrations: 0,
    pages: 0,
    candidates: 0,
    created: 0,
    updated: 0,
    interactions: 0,
    merged: 0,
    mergeSuggestions: 0,
    judged: 0,
    failed: 0,
    skipped: {},
    backfillsCompleted: 0,
    unsupported: [],
    errors: [],
  };
}

function skip(stats: CaptureStats, reasons: readonly CaptureSkipReason[]) {
  for (const reason of reasons)
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
}

interface WorkspaceBudget {
  captures: number;
  judgeCalls: number;
}

export interface ContactCaptureSyncResult {
  workspaces: number;
  integrations: number;
  captured: number;
  created: number;
  enriched: number;
  merged: number;
  failed: number;
}

interface CaptureRow {
  id: string;
  provider: string;
  composioAccountId: string;
  connectorUserId: string | null;
  cursor: Prisma.JsonValue | null;
  sokoBot: { id: string; userId: string | null; workspaceId: string };
  contactCaptureState: {
    id: string;
    backfillFloor: Date;
    cursor: Prisma.JsonValue;
    lastRunAt: Date | null;
    createdAt: Date;
  } | null;
}

interface RunContext {
  integration: ActiveIntegration;
  row: CaptureRow;
  teammateUserId: string;
  actor: ContactActor;
  identity: { ownerEmails: Set<string>; teammateEmails: Set<string> };
  budget: WorkspaceBudget;
  stats: CaptureStats;
  pagesLeft: number;
  now: Date;
  shouldContinue: () => boolean;
}

/** Page result: `complete` is false when a write budget cut it short. */
interface PageOutcome {
  complete: boolean;
}

function readCursor(value: Prisma.JsonValue | undefined): CaptureCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as CaptureCursor;
}

function toJson(cursor: CaptureCursor): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(cursor));
}

/** Active integrations capture reads, optionally of one workspace. */
async function loadCaptureRows(workspaceId?: string): Promise<CaptureRow[]> {
  return prisma.sokoBotIntegration.findMany({
    where: {
      status: "ACTIVE",
      provider: { in: Object.keys(PROVIDER_SOURCES) },
      sokoBot: { archivedAt: null, ...(workspaceId ? { workspaceId } : {}) },
    },
    select: {
      id: true,
      provider: true,
      composioAccountId: true,
      connectorUserId: true,
      cursor: true,
      sokoBot: { select: { id: true, userId: true, workspaceId: true } },
      contactCaptureState: {
        select: {
          id: true,
          backfillFloor: true,
          cursor: true,
          lastRunAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Members' addresses: none of them is ever a contact. */
async function workspaceMemberEmails(
  workspaceId: string,
): Promise<Map<string, string>> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      user: { select: { id: true, email: true } },
      organization: {
        select: {
          members: { select: { user: { select: { id: true, email: true } } } },
        },
      },
    },
  });
  const users = [
    ...(workspace?.user ? [workspace.user] : []),
    ...(workspace?.organization?.members.map((member) => member.user) ?? []),
  ];
  return new Map(users.map((user) => [user.id, user.email.toLowerCase()]));
}

function isConflict(error: unknown): boolean {
  return error instanceof HTTPException && error.status === 409;
}

export class ContactCaptureService {
  private readonly limits: CaptureLimits;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => Date;

  constructor(
    options: {
      limits?: Partial<CaptureLimits>;
      sleep?: (ms: number) => Promise<void>;
      now?: () => Date;
    } = {},
  ) {
    this.limits = { ...DEFAULT_CAPTURE_LIMITS, ...options.limits };
    this.sleep =
      options.sleep ??
      ((ms) =>
        ms > 0
          ? new Promise((resolve) => setTimeout(resolve, ms))
          : Promise.resolve());
    this.clock = options.now ?? (() => new Date());
  }

  /** One cron run: capture per workspace, then enrich queued contacts. */
  async sync(input: {
    shouldContinue: () => boolean;
  }): Promise<ContactCaptureSyncResult> {
    const result: ContactCaptureSyncResult = {
      workspaces: 0,
      integrations: 0,
      captured: 0,
      created: 0,
      enriched: 0,
      merged: 0,
      failed: 0,
    };
    const rows = await loadCaptureRows();
    // Whoever waited longest goes first, so a big backfill never starves
    // the others.
    rows.sort(
      (a, b) =>
        (a.contactCaptureState?.lastRunAt?.getTime() ?? 0) -
        (b.contactCaptureState?.lastRunAt?.getTime() ?? 0),
    );
    const byWorkspace = new Map<string, CaptureRow[]>();
    for (const row of rows) {
      const list = byWorkspace.get(row.sokoBot.workspaceId) ?? [];
      list.push(row);
      byWorkspace.set(row.sokoBot.workspaceId, list);
    }
    const pendingEnrichment = await workspacesWithPendingEnrichment(
      this.limits.enrichmentWorkspaces,
    );
    const workspaceIds = [
      ...new Set([...byWorkspace.keys(), ...pendingEnrichment]),
    ];
    for (const workspaceId of workspaceIds) {
      if (!input.shouldContinue()) break;
      const run = await this.runWorkspace(
        workspaceId,
        byWorkspace.get(workspaceId) ?? [],
        input.shouldContinue,
      );
      result.workspaces += 1;
      result.integrations += run.capture.integrations;
      result.captured += run.capture.interactions;
      result.created += run.capture.created;
      result.enriched += run.enrichment.enriched;
      result.merged += run.capture.merged + run.enrichment.merged;
      result.failed += run.capture.failed;
    }
    return result;
  }

  /** One workspace's capture and enrichment, outside the cron (lab, tests). */
  async captureWorkspace(
    workspaceId: string,
    shouldContinue: () => boolean,
  ): Promise<{ capture: CaptureStats; enrichment: EnrichmentStats }> {
    return this.runWorkspace(
      workspaceId,
      await loadCaptureRows(workspaceId),
      shouldContinue,
    );
  }

  /** Capture and enrichment for one workspace; one wide event per run. */
  private async runWorkspace(
    workspaceId: string,
    rows: CaptureRow[],
    shouldContinue: () => boolean,
  ): Promise<{ capture: CaptureStats; enrichment: EnrichmentStats }> {
    const log = createCoreLogger({ operation: "contact_capture" });
    const stats = emptyStats();
    const enrichment = emptyEnrichmentStats();
    const importance: ImportanceStats = { judged: 0, failed: 0 };
    const budget: WorkspaceBudget = {
      captures: this.limits.capturesPerWorkspace,
      judgeCalls: this.limits.judgeCallsPerWorkspace,
    };
    try {
      const members = rows.length
        ? await workspaceMemberEmails(workspaceId)
        : new Map<string, string>();
      for (const row of rows) {
        if (!shouldContinue()) break;
        await this.captureIntegration(
          row,
          members,
          budget,
          stats,
          shouldContinue,
        );
      }
      await enrichWorkspaceContacts({
        workspaceId,
        budget: {
          enrichments: this.limits.enrichmentsPerWorkspace,
          usd: this.limits.enrichmentUsdPerWorkspace,
        },
        stats: enrichment,
        shouldContinue,
      });
      // Familiarity fades with time even without new interactions.
      await refreshContactFamiliarity(prisma, { workspaceId });
      await judgeWorkspaceImportance({
        workspaceId,
        budget: this.limits.importanceJudgmentsPerWorkspace,
        stats: importance,
        shouldContinue,
      });
    } catch (error) {
      stats.errors.push(error instanceof Error ? error.message : "unknown");
      console.error("Contact capture failed", {
        workspaceId,
        error: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      log.set({
        workspace: { id: workspaceId },
        contactCapture: {
          integrations: stats.integrations,
          pages: stats.pages,
          candidates: stats.candidates,
          created: stats.created,
          updated: stats.updated,
          interactions: stats.interactions,
          merged: stats.merged,
          mergeSuggestions: stats.mergeSuggestions,
          judged: stats.judged,
          failed: stats.failed,
          skipped: stats.skipped,
          backfillsCompleted: stats.backfillsCompleted,
          unsupported: stats.unsupported,
          errors: stats.errors.slice(0, 5),
          budget: {
            capturesLeft: budget.captures,
            judgeCallsLeft: budget.judgeCalls,
            exhausted: budget.captures <= 0,
          },
        },
        contactImportance: importance,
        contactEnrichment: {
          ...enrichment,
          costUsd: Math.round(enrichment.costUsd * 1e6) / 1e6,
        },
      });
      log.emit();
    }
    return { capture: stats, enrichment };
  }

  private async captureIntegration(
    row: CaptureRow,
    members: Map<string, string>,
    budget: WorkspaceBudget,
    stats: CaptureStats,
    shouldContinue: () => boolean,
  ): Promise<void> {
    // A personal bot's integration is its owner's; a shared bot's belongs to
    // whoever connected it.
    const teammateUserId = row.connectorUserId ?? row.sokoBot.userId;
    if (!teammateUserId) return;
    stats.integrations += 1;
    const now = this.clock();
    const state =
      row.contactCaptureState ??
      (await prisma.contactCaptureState.upsert({
        where: { integrationId: row.id },
        create: {
          integrationId: row.id,
          backfillFloor: new Date(
            now.getTime() - this.limits.backfillDays * DAY_MS,
          ),
        },
        update: {},
        select: {
          id: true,
          backfillFloor: true,
          cursor: true,
          lastRunAt: true,
          createdAt: true,
        },
      }));
    const ownerEmail = members.get(teammateUserId);
    const context: RunContext = {
      integration: {
        id: row.id,
        sokoBotId: row.sokoBot.id,
        provider: resolveProvider(row.provider),
        composioAccountId: row.composioAccountId,
        connectorUserId: row.connectorUserId,
        cursor: row.cursor,
      },
      row,
      teammateUserId,
      actor: {
        workspaceId: row.sokoBot.workspaceId,
        userId: teammateUserId,
        sokoBotId: row.sokoBot.id,
      },
      identity: {
        ownerEmails: new Set(ownerEmail ? [ownerEmail] : []),
        teammateEmails: new Set(members.values()),
      },
      budget,
      stats,
      pagesLeft: this.limits.pagesPerIntegration,
      now,
      shouldContinue,
    };
    const cursor = readCursor(state.cursor);
    // Forward from when capture was scheduled; the backfill reads before it.
    const start = new Date(
      Math.min(state.createdAt.getTime(), now.getTime()),
    ).toISOString();
    let lastError: string | null = null;
    for (const source of PROVIDER_SOURCES[row.provider] ?? []) {
      const current: SourceCursor = cursor[source] ?? {
        since: start,
        backfillUntil: start,
        pageToken: null,
      };
      cursor[source] = current;
      const save = () =>
        prisma.contactCaptureState.update({
          where: { id: state.id },
          data: { cursor: toJson(cursor) },
        });
      try {
        if (current.pausedUntil && new Date(current.pausedUntil) > now)
          continue;
        delete current.pausedUntil;
        if (source === "slack") {
          await this.captureSlack(context, current, state.backfillFloor, save);
          continue;
        }
        await this.readForward(context, source, current, save);
        // Mail the owner received only counts from people they wrote to, so
        // the sent backfill runs first.
        if (
          source === "mail.received" &&
          cursor["mail.sent"]?.backfillUntil !== null
        )
          continue;
        await this.backfill(
          context,
          source,
          current,
          state.backfillFloor,
          save,
        );
      } catch (error) {
        if (
          error instanceof SokoBotIntegrationError &&
          error.kind === "NOT_FOUND"
        ) {
          current.pausedUntil = new Date(
            now.getTime() + this.limits.unsupportedPauseMs,
          ).toISOString();
          stats.unsupported.push(`${row.provider}:${source}`);
          await save();
          continue;
        }
        lastError = error instanceof Error ? error.message : "unknown";
        stats.errors.push(`${row.provider}:${source}: ${lastError}`);
        console.error("Contact capture source failed", {
          integrationId: row.id,
          provider: row.provider,
          source,
          error: lastError,
        });
      }
    }
    const sources = PROVIDER_SOURCES[row.provider] ?? [];
    const done = sources.every(
      (source) => cursor[source]?.backfillUntil === null,
    );
    const updated = await prisma.contactCaptureState.update({
      where: { id: state.id },
      data: {
        cursor: toJson(cursor),
        lastRunAt: now,
        lastError: lastError?.slice(0, 500) ?? null,
        ...(done ? { backfillCompletedAt: now } : {}),
      },
      select: { backfillCompletedAt: true },
    });
    if (done && updated.backfillCompletedAt?.getTime() === now.getTime())
      stats.backfillsCompleted += 1;
  }

  // -------------------------------------------------------------------------
  // Mail and calendar: forward window every run, backward windows after it.
  // -------------------------------------------------------------------------

  private async readForward(
    context: RunContext,
    source: Exclude<CaptureSource, "slack">,
    cursor: SourceCursor,
    save: () => Promise<unknown>,
  ): Promise<void> {
    const startedAt = context.now;
    const from = new Date(
      new Date(cursor.since).getTime() - this.limits.overlapMs,
    );
    let pageToken: string | undefined;
    do {
      if (!this.canRead(context)) return;
      const page = await this.readPage(context, source, {
        from,
        to: startedAt,
        pageToken,
      });
      if (!page.complete) return;
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    cursor.since = startedAt.toISOString();
    await save();
  }

  private async backfill(
    context: RunContext,
    source: Exclude<CaptureSource, "slack">,
    cursor: SourceCursor,
    floor: Date,
    save: () => Promise<unknown>,
  ): Promise<void> {
    while (cursor.backfillUntil !== null && this.canRead(context)) {
      const until = new Date(cursor.backfillUntil);
      const from = new Date(
        Math.max(
          floor.getTime(),
          until.getTime() - this.limits.windowDays * DAY_MS,
        ),
      );
      const page = await this.readPage(context, source, {
        from,
        to: until,
        pageToken: cursor.pageToken ?? undefined,
      });
      if (!page.complete) return;
      if (page.nextPageToken) {
        cursor.pageToken = page.nextPageToken;
      } else {
        cursor.pageToken = null;
        cursor.backfillUntil =
          from.getTime() <= floor.getTime() ? null : from.toISOString();
      }
      await save();
    }
  }

  private canRead(context: RunContext): boolean {
    return (
      context.shouldContinue() &&
      context.pagesLeft > 0 &&
      context.budget.captures > 0
    );
  }

  private async readPage(
    context: RunContext,
    source: Exclude<CaptureSource, "slack">,
    window: { from: Date; to: Date; pageToken?: string },
  ): Promise<PageOutcome & { nextPageToken: string | null }> {
    context.pagesLeft -= 1;
    context.stats.pages += 1;
    await this.sleep(this.limits.callSpacingMs);
    const extract: ExtractContext = {
      provider: context.integration.provider.id,
      teammateUserId: context.teammateUserId,
      identity: context.identity,
    };
    if (source === "calendar") {
      const page = await fetchCalendarPage(context.integration, {
        from: window.from,
        to: window.to,
        limit: this.limits.eventPageSize,
        pageToken: window.pageToken,
      });
      const extraction = mergeExtractions(
        page.raw.flatMap((raw) => {
          const event = parseEvent(raw);
          return event ? [extractMeeting(event, extract, context.now)] : [];
        }),
      );
      const outcome = await this.write(context, extraction);
      return { ...outcome, nextPageToken: page.nextPageToken };
    }
    const page = await fetchInboxPage(context.integration, {
      since: window.from,
      before: window.to,
      query:
        context.integration.provider.id === "gmail"
          ? GMAIL_QUERY[source]
          : undefined,
      folder: source === "mail.sent" ? "sentitems" : undefined,
      includePayload: true,
      limit: this.limits.mailPageSize,
      pageToken: window.pageToken,
    });
    const mails = page.raw.flatMap((raw) => parseMail(raw) ?? []);
    let extraction: Extraction;
    if (source === "mail.sent") {
      // The sender of sent mail is the owner, under whichever alias.
      for (const mail of mails)
        if (mail.from) context.identity.ownerEmails.add(mail.from.email);
      extraction = mergeExtractions(
        mails.map((mail) => extractSentMail(mail, extract)),
      );
    } else {
      extraction = await this.answeredOnly(
        context,
        mergeExtractions(
          mails.map((mail) => extractInboundMail(mail, extract)),
        ),
      );
    }
    const outcome = await this.write(context, extraction);
    return { ...outcome, nextPageToken: page.nextPageToken };
  }

  /** Inbound mail counts only from people this teammate wrote to or met. */
  private async answeredOnly(
    context: RunContext,
    extraction: Extraction,
  ): Promise<Extraction> {
    const emails = [
      ...new Set(
        extraction.candidates.flatMap((candidate) =>
          candidate.channels
            .filter((channel) => channel.type === "EMAIL")
            .map((channel) => channel.value),
        ),
      ),
    ];
    if (emails.length === 0) return extraction;
    const known = new Set(
      (
        await prisma.contactChannel.findMany({
          where: {
            workspaceId: context.actor.workspaceId,
            type: "EMAIL",
            value: { in: emails },
            contact: {
              interactions: {
                some: {
                  userId: context.teammateUserId,
                  direction: { in: ["OUT", "BOTH"] },
                },
              },
            },
          },
          select: { value: true },
        })
      ).map((channel) => channel.value),
    );
    const candidates = extraction.candidates.filter((candidate) =>
      candidate.channels.some(
        (channel) => channel.type === "EMAIL" && known.has(channel.value),
      ),
    );
    return {
      candidates,
      skipped: [
        ...extraction.skipped,
        ...Array<CaptureSkipReason>(
          extraction.candidates.length - candidates.length,
        ).fill("unanswered_inbound"),
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Writing.
  // -------------------------------------------------------------------------

  /**
   * Writes a page's candidates. Already captured ones are skipped before any
   * transaction; role inboxes need the judge. `complete` is false when the
   * workspace's write budget ran out, so the caller re-reads the page.
   */
  private async write(
    context: RunContext,
    extraction: Extraction,
  ): Promise<PageOutcome> {
    const { stats, budget } = context;
    skip(stats, extraction.skipped);
    const fresh = await this.withoutCaptured(context, extraction.candidates);
    skip(
      stats,
      Array<CaptureSkipReason>(
        extraction.candidates.length - fresh.length,
      ).fill("duplicate"),
    );
    const accepted = await this.judgeBorderline(context, fresh);
    for (const candidate of accepted) {
      if (budget.captures <= 0) return { complete: false };
      budget.captures -= 1;
      stats.candidates += 1;
      await this.capture(context, candidate);
    }
    return { complete: true };
  }

  private async withoutCaptured(
    context: RunContext,
    candidates: CaptureCandidate[],
  ): Promise<CaptureCandidate[]> {
    const unique = [
      ...new Map(
        candidates.map((candidate) => [
          `${candidate.interaction.channel}:${candidate.interaction.sourceRef}`,
          candidate,
        ]),
      ).values(),
    ];
    if (unique.length === 0) return [];
    const existing = await prisma.contactInteraction.findMany({
      where: {
        workspaceId: context.actor.workspaceId,
        OR: (["EMAIL", "MEETING", "SLACK"] as const).map((channel) => ({
          channel,
          sourceRef: {
            in: unique
              .filter((candidate) => candidate.interaction.channel === channel)
              .map((candidate) => candidate.interaction.sourceRef),
          },
        })),
      },
      select: { channel: true, sourceRef: true },
    });
    const seen = new Set(
      existing.map((row) => `${row.channel}:${row.sourceRef}`),
    );
    return unique.filter(
      (candidate) =>
        !seen.has(
          `${candidate.interaction.channel}:${candidate.interaction.sourceRef}`,
        ),
    );
  }

  /** Role inboxes pass only on Jev's word, within the workspace's call budget. */
  private async judgeBorderline(
    context: RunContext,
    candidates: CaptureCandidate[],
  ): Promise<CaptureCandidate[]> {
    const borderline = candidates.filter((candidate) => candidate.borderline);
    if (borderline.length === 0) return candidates;
    const accepted = new Set<CaptureCandidate>(
      candidates.filter((candidate) => !candidate.borderline),
    );
    // One verdict per address, shared by its interactions on the page.
    const byEmail = new Map<string, CaptureCandidate[]>();
    for (const candidate of borderline) {
      const email = candidate.channels[0]?.value ?? "";
      byEmail.set(email, [...(byEmail.get(email) ?? []), candidate]);
    }
    const emails = [...byEmail.keys()];
    for (
      let start = 0;
      start < emails.length;
      start += this.limits.judgeBatch
    ) {
      const batch = emails.slice(start, start + this.limits.judgeBatch);
      let ratings: number[] | null = null;
      if (context.budget.judgeCalls > 0) {
        context.budget.judgeCalls -= 1;
        context.stats.judged += batch.length;
        ratings = await judgeRoleInboxes(
          batch.map((email) => {
            const sample = byEmail.get(email)?.[0];
            return {
              email,
              name: sample?.name ?? null,
              topic: sample?.interaction.summary ?? "",
              direction: sample?.interaction.direction ?? "OUT",
            };
          }),
        );
      }
      batch.forEach((email, index) => {
        const group = byEmail.get(email) ?? [];
        if (ratings === null) {
          skip(
            context.stats,
            Array<CaptureSkipReason>(group.length).fill("borderline_unjudged"),
          );
        } else if ((ratings[index] ?? 0) >= MIN_PERSON_PROBABILITY) {
          for (const candidate of group) accepted.add(candidate);
        } else {
          skip(
            context.stats,
            Array<CaptureSkipReason>(group.length).fill("borderline_rejected"),
          );
        }
      });
    }
    return candidates.filter((candidate) => accepted.has(candidate));
  }

  private async capture(
    context: RunContext,
    candidate: CaptureCandidate,
  ): Promise<void> {
    const { stats, actor } = context;
    const channels = candidate.channels.flatMap((channel) => {
      const value = normalizeContactChannelValue(channel.type, channel.value);
      return value
        ? [{ type: channel.type, value, verified: channel.verified ?? false }]
        : [];
    });
    if (!channels.length) {
      skip(stats, ["invalid_address"]);
      return;
    }
    const attempt = () =>
      inContactTransaction((tx) =>
        captureContactInteraction(tx, actor, {
          name: candidate.name,
          organization: candidate.organization,
          role: candidate.role,
          channels,
          interaction: candidate.interaction,
          teammateUserId: context.teammateUserId,
        }),
      );
    let result: Awaited<ReturnType<typeof attempt>>;
    try {
      result = await attempt().catch((error: unknown) => {
        if (isConflict(error)) return attempt();
        throw error;
      });
    } catch (error) {
      stats.failed += 1;
      console.error("Contact capture write failed", {
        integrationId: context.row.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return;
    }
    if (result.created) stats.created += 1;
    else if (result.changed) stats.updated += 1;
    if (result.interactionCreated) stats.interactions += 1;
    const suggestion = result.mergeSuggestion;
    if (!suggestion) return;
    // A Slack profile vouches that its email and its Slack account are one
    // person: certain enough to merge. Anything else is a suggestion.
    const verified = channels.every((channel) => channel.verified);
    if (!verified) {
      stats.mergeSuggestions += 1;
      return;
    }
    const [winner, ...losers] = suggestion.contactIds;
    if (!winner || losers.length === 0) return;
    try {
      await inContactTransaction((tx) =>
        mergeContacts(tx, actor, winner, losers),
      );
      stats.merged += 1;
    } catch (error) {
      stats.mergeSuggestions += 1;
      console.warn("Contact capture merge skipped", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Slack: whom the owner talks with in direct messages and small channels.
  // -------------------------------------------------------------------------

  private async slackCall(
    context: RunContext,
    budget: { calls: number },
    tool: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    budget.calls -= 1;
    context.stats.pages += 1;
    await this.sleep(this.limits.callSpacingMs);
    return runIntegrationTool(context.integration, tool, args);
  }

  private async captureSlack(
    context: RunContext,
    cursor: SourceCursor,
    floor: Date,
    save: () => Promise<unknown>,
  ): Promise<void> {
    const tools = SOKO_BOT_SLACK_CAPTURE_TOOLS;
    const budget = { calls: this.limits.slackCallsPerRun };
    // Feature detection: a toolkit without the tool, or an account that
    // cannot say who it is, pauses Slack capture for this integration.
    const auth = await this.slackCall(
      context,
      budget,
      tools.authTest,
      {},
    ).catch((error: unknown) => {
      throw new SokoBotIntegrationError(
        error instanceof Error ? error.message : "Slack is unavailable",
        "NOT_FOUND",
      );
    });
    const ownerSlackId = textOf(auth, "user_id");
    const teamId = textOf(auth, "team_id");
    if (!ownerSlackId || !teamId)
      throw new SokoBotIntegrationError(
        "Slack did not say who is connected",
        "NOT_FOUND",
      );
    const profiles = new Map<string, SlackProfile | null>();
    const walk = (from: Date, to: Date, token: string | null) =>
      this.walkSlack(context, {
        budget,
        ownerSlackId,
        teamId,
        profiles,
        from,
        to,
        token,
      });

    const now = context.now;
    const since = new Date(cursor.since);
    if (now.getTime() - since.getTime() >= this.limits.slackIntervalMs) {
      const forward = await walk(
        new Date(since.getTime() - this.limits.overlapMs),
        now,
        cursor.forwardToken ?? null,
      );
      if (forward.done) {
        cursor.since = now.toISOString();
        cursor.forwardToken = null;
      } else cursor.forwardToken = forward.token;
      await save();
    }
    if (cursor.backfillUntil !== null && this.canRead(context)) {
      const backfill = await walk(
        floor,
        new Date(cursor.backfillUntil),
        cursor.pageToken,
      );
      if (backfill.done) {
        cursor.backfillUntil = null;
        cursor.pageToken = null;
      } else cursor.pageToken = backfill.token;
      await save();
    }
  }

  /**
   * Walks the owner's conversations between `from` and `to`, resuming at
   * `token` (`{list, index, history}`), until done or out of calls.
   */
  private async walkSlack(
    context: RunContext,
    input: {
      budget: { calls: number };
      ownerSlackId: string;
      teamId: string;
      profiles: Map<string, SlackProfile | null>;
      from: Date;
      to: Date;
      token: string | null;
    },
  ): Promise<{ done: boolean; token: string | null }> {
    const tools = SOKO_BOT_SLACK_CAPTURE_TOOLS;
    let position = parseSlackToken(input.token);
    while (input.budget.calls > 0 && this.canRead(context)) {
      const list = await this.slackCall(
        context,
        input.budget,
        tools.listConversations,
        {
          types: "im,mpim,private_channel,public_channel",
          exclude_archived: true,
          limit: 200,
          ...(position.list ? { cursor: position.list } : {}),
        },
      );
      const conversations = listOf(list, "channels").flatMap(
        (raw) => parseSlackConversation(raw) ?? [],
      );
      while (position.index < conversations.length) {
        const conversation = conversations[position.index];
        if (!conversation) break;
        const result = await this.readSlackConversation(context, {
          ...input,
          conversation,
          historyCursor: position.history,
        });
        if (!result.done) {
          return {
            done: false,
            token: JSON.stringify({ ...position, history: result.cursor }),
          };
        }
        position = { ...position, index: position.index + 1, history: null };
      }
      const next = textOf(field(list, "response_metadata"), "next_cursor");
      if (!next) return { done: true, token: null };
      position = { list: next, index: 0, history: null };
    }
    return { done: false, token: JSON.stringify(position) };
  }

  private async readSlackConversation(
    context: RunContext,
    input: {
      budget: { calls: number };
      ownerSlackId: string;
      teamId: string;
      profiles: Map<string, SlackProfile | null>;
      conversation: SlackConversation;
      from: Date;
      to: Date;
      historyCursor: string | null;
    },
  ): Promise<{ done: boolean; cursor: string | null }> {
    const tools = SOKO_BOT_SLACK_CAPTURE_TOOLS;
    const { conversation } = input;
    if (!conversation.isDirect) {
      if (input.budget.calls <= 0) return { done: false, cursor: null };
      const members = await this.slackCall(
        context,
        input.budget,
        tools.conversationMembers,
        { channel: conversation.id, limit: this.limits.slackSmallChannel + 1 },
      );
      if (listOf(members, "members").length > this.limits.slackSmallChannel)
        return { done: true, cursor: null };
    }
    const messages: unknown[] = [];
    let cursor = input.historyCursor;
    let pages = 0;
    do {
      if (
        input.budget.calls <= 0 ||
        pages >= this.limits.slackHistoryPagesPerConversation
      )
        break;
      pages += 1;
      const history = await this.slackCall(
        context,
        input.budget,
        tools.conversationHistory,
        {
          channel: conversation.id,
          oldest: String(Math.floor(input.from.getTime() / 1000)),
          latest: String(Math.floor(input.to.getTime() / 1000)),
          limit: 200,
          ...(cursor ? { cursor } : {}),
        },
      );
      messages.push(...listOf(history, "messages"));
      cursor =
        textOf(field(history, "response_metadata"), "next_cursor") || null;
    } while (cursor);
    const talks = extractSlackConversation({
      conversation,
      days: slackDays(messages),
      ownerSlackId: input.ownerSlackId,
      teamId: input.teamId,
      teammateUserId: context.teammateUserId,
    });
    const candidates: CaptureCandidate[] = [];
    const skipped: CaptureSkipReason[] = [];
    for (const talk of talks) {
      const profile = await this.slackProfile(context, input, talk.userId);
      if (!profile || profile.isBot || profile.deleted) {
        skipped.push("bot_user");
        continue;
      }
      if (profile.email && context.identity.ownerEmails.has(profile.email)) {
        skipped.push("self");
        continue;
      }
      if (profile.email && context.identity.teammateEmails.has(profile.email)) {
        skipped.push("teammate");
        continue;
      }
      candidates.push(
        slackCandidate({
          profile,
          conversation,
          day: talk.day,
          direction: talk.direction,
          teammateUserId: context.teammateUserId,
          teamId: input.teamId,
        }),
      );
    }
    const outcome = await this.write(context, { candidates, skipped });
    // Unread history or an unfinished write: come back to this conversation.
    if (cursor || !outcome.complete)
      return {
        done: false,
        cursor: outcome.complete ? cursor : input.historyCursor,
      };
    return { done: true, cursor: null };
  }

  private async slackProfile(
    context: RunContext,
    input: {
      budget: { calls: number };
      profiles: Map<string, SlackProfile | null>;
    },
    userId: string,
  ): Promise<SlackProfile | null> {
    if (input.profiles.has(userId)) return input.profiles.get(userId) ?? null;
    if (input.budget.calls <= 0) return null;
    const data = await this.slackCall(
      context,
      input.budget,
      SOKO_BOT_SLACK_CAPTURE_TOOLS.userInfo,
      { user: userId },
    );
    const profile = parseSlackProfile(data);
    input.profiles.set(userId, profile);
    return profile;
  }
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function textOf(value: unknown, key: string): string {
  const found = field(value, key);
  return typeof found === "string" ? found : "";
}

function listOf(value: unknown, key: string): unknown[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}

function parseSlackToken(token: string | null): {
  list: string | null;
  index: number;
  history: string | null;
} {
  if (!token) return { list: null, index: 0, history: null };
  try {
    const parsed = JSON.parse(token) as Record<string, unknown>;
    return {
      list: typeof parsed.list === "string" ? parsed.list : null,
      index: typeof parsed.index === "number" ? parsed.index : 0,
      history: typeof parsed.history === "string" ? parsed.history : null,
    };
  } catch {
    return { list: null, index: 0, history: null };
  }
}

function mergeExtractions(extractions: Extraction[]): Extraction {
  return {
    candidates: extractions.flatMap((extraction) => extraction.candidates),
    skipped: extractions.flatMap((extraction) => extraction.skipped),
  };
}

/**
 * Called when an integration becomes active: a new account starts a fresh
 * 12-month backfill on the next capture run. A reconnect of the same account
 * keeps its progress.
 */
export async function scheduleContactCapture(input: {
  integrationId: string;
  provider: string;
  reset: boolean;
}): Promise<void> {
  const { integrationId } = input;
  if (!PROVIDER_SOURCES[input.provider]) return;
  if (input.reset)
    await prisma.contactCaptureState.deleteMany({ where: { integrationId } });
  const now = new Date();
  await prisma.contactCaptureState.upsert({
    where: { integrationId },
    create: {
      integrationId,
      backfillFloor: new Date(
        now.getTime() - DEFAULT_CAPTURE_LIMITS.backfillDays * DAY_MS,
      ),
    },
    update: {},
  });
}

export const contactCaptureService = new ContactCaptureService();
