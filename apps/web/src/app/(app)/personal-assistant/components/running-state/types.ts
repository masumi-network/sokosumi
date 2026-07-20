import type { HermesUiMessage } from "@/lib/hermes/merge-persisted-messages";
import type {
  HermesInstancePublic,
  HermesPendingConfirmation,
} from "@/lib/hermes/types";

export type Message = HermesUiMessage;

/** A step in a turn's trace: a `tool` action chip or a `reasoning` beat.
 * Absent `kind` is treated as "tool" (older persisted rows). */
export interface ProgressStep {
  kind?: "tool" | "reasoning";
  /** tool_call_id — matches a `tool` frame to its `tool_done`. */
  id?: string;
  /** tool: the action label; reasoning: the chain-of-thought snippet. */
  label: string;
  detail?: string;
  /** Set once the tool's `tool_done` frame arrives (chip completes). */
  done?: boolean;
}

export interface ChatApiResponse {
  data?: {
    message?: { role?: string; content?: string };
    status?: string;
  };
  error?: string;
  message?: string;
}

export type HermesIntegrationPublic = NonNullable<
  HermesInstancePublic["integrations"]
>[number];
export type HermesIntegrationProvider = HermesIntegrationPublic["provider"];

/**
 * Captures what the user did with a confirmation so the card can be
 * re-rendered as a read-only audit trail. `organizationId === undefined`
 * means the tool wasn't org-aware (no dropdown was shown); `null` means
 * the user explicitly picked personal scope.
 */
export interface ConfirmationResolution {
  status: "approved" | "rejected" | "already_resolved";
  organizationId?: string | null;
}

export type TimelineEntry =
  | { kind: "message"; ts: number; key: string; message: Message }
  | {
      kind: "resolved";
      ts: number;
      key: string;
      entry: ResolvedConfirmationEntry;
    };

export interface ResolvedConfirmationEntry {
  confirmation: HermesPendingConfirmation;
  resolution: ConfirmationResolution;
  /**
   * Fixed timeline position: just past the newest message visible at the
   * moment the user resolved the card. Snapshotted once so the card stays
   * exactly where the user acted — mixing the gate's server `createdAt`
   * with client-clock message timestamps let the card teleport above the
   * user's own (optimistically-stamped) message on approval, then strand
   * far up in the scrollback once the post-turn re-sync rewrote message
   * ids/timestamps to server time.
   */
  timelineTs: number;
}

export interface ParsedTaskResult {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  credits: number | null;
  coworker: { name: string; image: string | null } | null;
  organization: { name: string; slug: string | null } | null;
}

export interface ParsedConfirmationResolved {
  /** Prose lead-in with the JSON block stripped out. */
  summary: string;
  /** Populated when the JSON payload matched the sokosumi_create_task shape. */
  task: ParsedTaskResult | null;
}
