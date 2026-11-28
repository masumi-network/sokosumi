import { convertCentsToCredits } from "@sokosumi/utils";
import type { AgentPreview, UserPreview } from "@/helpers/history";
import type { TransactionHistoryRow } from "@/lib/credits/history";
import { findImageModelForEndpoint } from "@/lib/image-studio/catalog";

export interface MapTransactionHistoryRowOptions {
  agentPreviewById?: Map<string, AgentPreview>;
  userPreviewById?: Map<string, UserPreview>;
}

/**
 * A top up is named by the bucket it created. `CreditBucketReferenceType` is
 * the only thing that distinguishes a purchase from a refund or a plan grant,
 * and `referenceNote` carries the free-text detail when there is one.
 */
const TOP_UP_TITLE_BY_SOURCE: Record<string, string> = {
  STRIPE_TOPUP: "Credit top up",
  STRIPE_FREE: "Free credits",
  STRIPE_SUBSCRIPTION_PERIOD: "Subscription credits",
  REFUND: "Refund",
  ENTERPRISE_PERIOD: "Enterprise plan credits",
  ENTERPRISE_TOP_UP: "Enterprise top up",
  SIGNUP_BONUS: "Signup bonus",
  FREE: "Free credits",
  POLAR_SUBSCRIPTION_MONTH: "CMO plan credits",
  PROJECT_TOP_UP: "Project top-up",
  CMO_TESTER_CREDITS: "CMO tester credits",
};

/**
 * Why a refund happened, in words a user can act on. Never the raw failure
 * reason: that is a node or chain error, not something to show a customer.
 */
function refundReason(row: TransactionHistoryRow): string | null {
  switch (row.refundSource) {
    case "job":
      return row.refundedJobOnChainStatus === "REFUND_WITHDRAWN"
        ? "Refund approved"
        : "Payment could not be completed";
    case "taskPaymentClaim":
    case "projectImage":
      return "Payment could not be completed";
    case "taskX402":
      switch (row.refundX402Kind) {
        case "NODE_REFUSAL":
          return "Payment was refused";
        case "OPERATOR_GOODWILL":
        case "OPERATOR_RESOLVE":
          return "Refunded by support";
        default:
          return null;
      }
    default:
      return null;
  }
}

function refundSubjectName(row: TransactionHistoryRow): string | null {
  switch (row.refundSource) {
    case "job":
      return row.refundedJobName;
    case "projectImage":
      return row.refundedImagePrompt;
    case "taskPaymentClaim":
    case "taskX402":
      return row.refundedTaskName;
    default:
      return null;
  }
}

/**
 * Why and what a refund top up refunded, or null when nothing is known. The
 * reason leads: it is short, and a long job name would push it off a phone row.
 * A known reason with no name still shows the reason — the row can link by id.
 */
function refundDescription(row: TransactionHistoryRow): string | null {
  const name = refundSubjectName(row);
  const reason = refundReason(row);
  if (!name) return reason;
  return reason ? `${reason} · ${truncate(name)}` : truncate(name);
}

/** A prompt is a paragraph; a list row is a line. */
function truncate(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max
    ? `${normalized.slice(0, max - 1)}…`
    : normalized;
}

const SOKO_BOT_SYSTEM_SCHEDULE_LABELS: Record<string, string> = {
  standup: "Daily stand-up",
  "weekly-wrap": "Weekly wrap",
  "meeting-prep": "Meeting prep",
  "end-of-day": "End of day",
  "follow-ups": "Follow-up check",
  "monday-plan": "Monday plan",
  "monthly-review": "Monthly review",
  "memory-cleanup": "Memory cleanup",
  dreaming: "Dreaming",
};

const SOKO_BOT_SOURCE_LABELS: Record<string, string> = {
  CHAT: "Chat",
  INGEST: "Inbox and calendar check",
  EVENT: "Task update",
  ADMIN_RETRY: "Retry",
};

/** What a billed turn was for, from its source and schedule. */
function sokoBotTurnLabel(row: TransactionHistoryRow): string | null {
  if (row.sokoBotTurnSource === "SCHEDULE") {
    const key = row.sokoBotScheduleKey ?? "";
    const named = row.sokoBotScheduleName
      ? `Scheduled: ${row.sokoBotScheduleName}`
      : "Scheduled";
    return SOKO_BOT_SYSTEM_SCHEDULE_LABELS[key] ?? named;
  }
  return SOKO_BOT_SOURCE_LABELS[row.sokoBotTurnSource ?? ""] ?? null;
}

export function mapTransactionHistoryRow(
  row: TransactionHistoryRow,
  options?: MapTransactionHistoryRowOptions,
) {
  const userPreview = row.userId
    ? options?.userPreviewById?.get(row.userId)
    : undefined;
  const base = {
    id: row.id,
    // `Transaction.amount` is signed: negative is a spend, positive is a top
    // up. Report the magnitude and let `kind` carry the direction, so no
    // caller has to know the sign convention to render a number.
    credits: convertCentsToCredits(row.amount < 0n ? -row.amount : row.amount),
    consumedAt: row.consumedAt.toISOString(),
    projectId: row.projectId,
    owner: userPreview
      ? {
          userId: userPreview.userId,
          name: userPreview.name,
          image: userPreview.image,
        }
      : null,
  };

  switch (row.kind) {
    case "job": {
      const agentPreview = row.agentId
        ? options?.agentPreviewById?.get(row.agentId)
        : undefined;
      return {
        ...base,
        kind: row.kind,
        title: row.jobName ?? agentPreview?.name ?? "Agent job",
        description: agentPreview?.name ?? null,
        jobId: row.jobId ?? "",
        agentId: row.agentId,
        agentName: agentPreview?.name ?? null,
        agentIcon: agentPreview?.icon ?? null,
      };
    }
    case "image": {
      // The catalog is the authority on a model's display name and it is live,
      // so this resolves at read time. A model fal has since withdrawn falls
      // back to the endpoint, which is still true about the image.
      const endpoint = row.imageModel ?? "";
      const modelLabel =
        findImageModelForEndpoint(endpoint)?.label ??
        // A model the catalog no longer lists. The endpoint still names what
        // made the image, which is more use than "Unknown model".
        (endpoint.replace(/^[^/]+\//, "") || "Unknown model");
      return {
        ...base,
        kind: row.kind,
        title: row.imagePrompt ? truncate(row.imagePrompt) : modelLabel,
        description: modelLabel,
        imageJobId: row.imageJobId ?? "",
        modelLabel,
      };
    }
    case "task":
      return {
        ...base,
        kind: row.kind,
        title: row.taskName ?? "Task",
        description: row.taskEventComment
          ? truncate(row.taskEventComment)
          : null,
        taskId: row.taskId ?? "",
        taskEventId: row.taskEventId ?? "",
        taskArchived: row.taskArchived ?? false,
      };
    case "coworker":
      return {
        ...base,
        kind: row.kind,
        title: row.coworkerName ?? "Coworker usage",
        description: null,
        coworkerId: row.coworkerId ?? "",
      };
    case "sokoBot":
      return {
        ...base,
        kind: row.kind,
        title: `Soko Bot · ${row.sokoBotName?.trim() || "Unnamed"}`,
        description: sokoBotTurnLabel(row),
        sokoBotId: row.sokoBotId ?? "",
      };
    case "seoChat":
      return { ...base, kind: row.kind, title: "SEO chat", description: null };
    case "contacts":
      return {
        ...base,
        kind: row.kind,
        title: row.contactName
          ? `Enrich · ${row.contactName}`
          : `Find people · ${row.contactListName ?? "Deleted list"}`,
        description:
          row.contactFound === null || row.contactName
            ? null
            : `${row.contactFound} ${row.contactFound === 1 ? "person" : "people"} found`,
        contactListId: row.contactListId,
      };
    case "topUp":
      return {
        ...base,
        kind: row.kind,
        title: TOP_UP_TITLE_BY_SOURCE[row.topUpSource ?? ""] ?? "Top up",
        // Refund what/why wins over a free-text note so a REFUND row always
        // says what it refunded when the ledger knows. Notes still fill gaps
        // for other top ups and for orphan refunds with no linked entity.
        description:
          refundDescription(row) ??
          (row.topUpNote ? truncate(row.topUpNote) : null),
        bucketSource: row.topUpSource,
        refundedJobId: row.refundedJobId,
        refundedAgentId: row.refundedAgentId,
        // An archived task is a 404 everywhere: name it, but link nowhere.
        refundedTaskId: row.refundedTaskArchived ? null : row.refundedTaskId,
      };
    case "unattributed":
      // Nothing links this spend to an entity. Say so plainly: the date, the
      // amount and the bucket it drew from are everything that is known, and
      // inventing a source would be worse than an honest blank.
      return {
        ...base,
        kind: row.kind,
        title: "Credit consumption",
        description: null,
        bucketSource: row.bucketSource,
      };
  }
}
