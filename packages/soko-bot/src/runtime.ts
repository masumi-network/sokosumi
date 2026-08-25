import type { SokoBotCapability, SokoBotRoute } from "./policy.js";

export interface SokoBotActorContext {
  userId: string;
  sokoBotId: string;
  workspaceId: string;
}

export interface SokoBotContextPacket {
  schemaVersion: 1;
  generatedAt: string;
  hash: string;
  trigger: {
    source: "CHAT" | "SCHEDULE" | "ADMIN_RETRY" | "EVENT";
    route: SokoBotRoute;
    confidence: number;
    requestedOutcome: string;
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

export interface SokoBotRequestClaims extends SokoBotActorContext {
  issuer: string;
  audience: string;
  subject: string;
  jwtId: string;
  sessionId: string;
  turnId: string;
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
  requestToken: string;
  turnGrant: string;
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
  requestToken: string;
  startIndex: number;
  signal?: AbortSignal;
}

export interface RuntimeCancelInput {
  sessionId: string;
  eveTurnId?: string;
  requestToken: string;
}

export interface RuntimeResetInput {
  sessionId: string;
  reason: string;
  requestToken: string;
}

export interface RuntimeInspectInput {
  sessionId: string;
  requestToken: string;
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
