import type { SokoBotCapability, SokoBotRoute } from "./policy.js";

export interface SokoBotActorContext {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
}

export interface SokoBotSourceCoverage {
  source: string;
  checkedAt: string | null;
  filters: Record<string, string>;
  scannedCount: number;
  includedCount: number;
  omittedCount: number;
  completeness: "COMPLETE" | "TRUNCATED" | "NOT_CHECKED";
  availability:
    | "AVAILABLE"
    | "DISCONNECTED"
    | "PERMISSION_DENIED"
    | "QUERY_FAILED"
    | "NOT_FETCHED";
}

export interface SokoBotContextPacket {
  schemaVersion: 1;
  generatedAt: string;
  hash: string;
  trigger: {
    source: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT" | "INGEST";
    route: SokoBotRoute;
    confidence: number;
    requestedOutcome: string;
    /**
     * Who is on the other side of this turn. The turn always runs as the
     * owner — their bot, their credits — so `actor` is the owner whatever
     * happens, and this is the only field that tells a colleague asking in a
     * shared room apart from the owner asking in their own.
     */
    askedBy: {
      kind: "OWNER" | "TEAMMATE" | "ASSISTANT";
      /** Null for `ASSISTANT`: the only id behind one is its owner's. */
      name: string | null;
      trust: "untrusted-data";
    };
  };
  actor: Record<string, unknown>;
  workspace: Record<string, unknown>;
  projects: readonly Record<string, unknown>[];
  tasks: readonly Record<string, unknown>[];
  coworkers: readonly Record<string, unknown>[];
  agents: readonly Record<string, unknown>[];
  jobs: readonly Record<string, unknown>[];
  pendingDecisions: readonly Record<string, unknown>[];
  recentTurns: readonly Record<string, unknown>[];
  memory: { version: number; hash: string | null; markdown: string };
  counts: Record<string, number>;
  omissions: Record<string, number>;
  sourceCoverage?: Record<string, SokoBotSourceCoverage>;
}

export interface SokoBotTurnGrantClaims extends SokoBotActorContext {
  issuer: string;
  audience: string;
  subject: string;
  jwtId: string;
  sessionId: string;
  turnId: string;
  contextSnapshotId: string;
  memoryRevisionId: string | null;
  memoryVersion: number;
  capabilities: readonly SokoBotCapability[];
  issuedAt: number;
  expiresAt: number;
}

export interface RuntimeSessionRef {
  sessionId: string;
  runtimeVersion: string;
}

export interface RuntimeTurnInput extends SokoBotActorContext {
  sessionId: string | null;
  turnId: string;
  message: string;
}

export interface RuntimeTurnRef extends RuntimeSessionRef {
  acceptedAt: string;
}

export interface RuntimeEvent {
  type: string;
  data: Record<string, unknown>;
  meta: { id: string; at: string };
}

export interface IndexedRuntimeEvent {
  startIndex: number;
  event: RuntimeEvent;
}

export interface RuntimeEventStreamInput {
  sessionId: string;
  startIndex: number;
  signal?: AbortSignal;
}

export interface RuntimeCancelInput {
  sessionId: string;
  eveTurnId?: string;
}

export interface RuntimeResetInput {
  sessionId: string;
  reason: string;
}

export interface RuntimeInspectInput {
  sessionId: string;
}

export interface RuntimeHealth {
  healthy: boolean;
  runtimeVersion: string;
  sessionStatus: string | null;
}

export interface SokoBotRuntime {
  createSession(input: RuntimeTurnInput): Promise<RuntimeTurnRef>;
  streamEvents(
    input: RuntimeEventStreamInput,
  ): AsyncIterable<IndexedRuntimeEvent>;
  cancelTurn(input: RuntimeCancelInput): Promise<void>;
  resetSession(input: RuntimeResetInput): Promise<void>;
  inspectSession(input: RuntimeInspectInput): Promise<RuntimeHealth>;
}

export interface SokoBotActionReceipt {
  id: string;
  operationKey: string;
  turnId: string;
  toolCallId: string;
  action: string;
  targetId: string | null;
  disposition: "APPLIED" | "ALREADY_SATISFIED" | "REJECTED" | "UNKNOWN";
  actorBotId: string;
  effectEventId: string | null;
  observedVersion: string | null;
  committedAt: string | null;
  verification: "LOCAL_TRANSACTION" | "PROVIDER_ACK" | "READ_BACK" | "NONE";
}

export interface SokoBotActionResponse {
  appliedReceiptIds: string[];
  observations: string[];
  unfulfilledActions: { action: string; receiptId: string; reason: string }[];
  answerText: string;
}
