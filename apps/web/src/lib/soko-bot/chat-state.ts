import type {
  SokoBot,
  SokoBotDelegation,
  SokoBotEvent,
  SokoBotLegacyMessage,
  SokoBotPendingDecision,
  SokoBotSchedule,
  SokoBotStatus,
  SokoBotToolCall,
  SokoBotTurn,
  SokoBotTurnRoute,
  SokoBotTurnStatus,
} from "@/lib/clients/generated/core";

/**
 * JSON-safe projection of the Soko Bot chat surface. The server page renders
 * it once; the client polls `/api/personal-assistant/state` for the same
 * shape while a turn is running. Dates are ISO strings so the two paths stay
 * identical after serialisation.
 */

export interface ChatTurnEvent {
  id: string;
  sequence: number;
  type: string;
  summary: string | null;
  toolName: string | null;
  toolStatus: string | null;
  durationMs: number | null;
  createdAt: string;
  payload: Record<string, unknown> | null;
}

export interface ChatToolCall {
  id: string;
  capability: string;
  input: unknown;
  status: SokoBotToolCall["status"];
  result: unknown;
  errorKind: string | null;
  errorDetail: string | null;
  createdAt: string;
}

export interface ChatContextSummary {
  projects: number;
  tasks: number;
  coworkers: number;
  agents: number;
  jobs: number;
  recentTurns: number;
  memoryVersion: number;
  bytes: number;
}

export interface ChatDecision {
  id: string;
  turnId: string;
  toolName: string;
  proposal: Record<string, unknown>;
  reason: string;
  status: SokoBotPendingDecision["status"];
  expiresAt: string;
  resolvedAt: string | null;
  resultingEntityId: string | null;
  createdAt: string;
}

export interface ChatDelegation {
  id: string;
  kind: SokoBotDelegation["kind"];
  action: string;
  outcome: string | null;
  error: string | null;
  taskId: string | null;
  jobId: string | null;
}

export interface ChatTurn {
  id: string;
  source: SokoBotTurn["source"];
  status: SokoBotTurnStatus;
  route: SokoBotTurnRoute;
  userMessage: string;
  finalAnswer: string | null;
  errorKind: string | null;
  errorDetail: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  events: ChatTurnEvent[];
  delegations: ChatDelegation[];
  decisions: ChatDecision[];
  /** Teammate who asked in chat; null when the owner asked. */
  requestedBy: { id: string; name: string | null; image: string | null } | null;
  /** Room a chat-started turn came from. */
  chatRoom: { id: string; name: string | null; kind: string } | null;
  /** Judge model's 1–5 overall score, once graded. */
  qualityScore: number | null;
  /** Client-only: sent but Core has not echoed it back yet. */
  optimistic?: boolean;
}

/** Detail route only: everything the owner needs to explain a turn. */
export interface ChatTurnDetail extends ChatTurn {
  classification: Record<string, unknown> | null;
  classifierModel: string | null;
  classifierLatencyMs: number | null;
  classificationFailed: boolean;
  capabilityNames: string[];
  modelId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  } | null;
  toolCalls: ChatToolCall[];
  contextSummary: ChatContextSummary | null;
  /** Exactly what the runtime received: context packet and version. */
  contextPacket: unknown;
  versionId: string | null;
}

export interface ChatLegacyMessage {
  id: string;
  role: string;
  content: string;
  kind: string | null;
  stepCount: number;
  durationMs: number | null;
  createdAt: string;
}

export interface ChatSchedule {
  id: string;
  name: string;
  enabled: boolean;
  timezone: string;
  cronExpression: string;
  prompt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  consecutiveFailures: number;
}

export interface ChatMemory {
  version: number;
  markdown: string;
  createdAt: string;
}

export interface ChatBot {
  id: string;
  userId: string;
  name: string | null;
  avatarSeed: string | null;
  /** Picked mascot image; null → generative orb. */
  avatarImageUrl: string | null;
  versionId: string | null;
  /** Chat coworker row id; open a direct with it to talk to the bot. */
  coworkerId: string | null;
  status: SokoBotStatus;
  memoryVersion: number;
  memory: ChatMemory | null;
  lastActivityAt: string | null;
  schedules: ChatSchedule[];
  legacyMessages: ChatLegacyMessage[];
  pendingDecisions: ChatDecision[];
}

export interface SokoBotChatState {
  bot: ChatBot;
  /** Newest first, as Core returns them. */
  turns: ChatTurn[];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toEvent(event: SokoBotEvent): ChatTurnEvent {
  return {
    id: event.id,
    sequence: event.sequence,
    type: event.type,
    summary: event.summary,
    toolName: event.toolName,
    toolStatus: event.toolStatus,
    durationMs: event.durationMs,
    createdAt: event.createdAt.toISOString(),
    payload:
      (event.payload as Record<string, unknown> | null | undefined) ?? null,
  };
}

function toToolCall(call: SokoBotToolCall): ChatToolCall {
  return {
    id: call.id,
    capability: call.capability,
    input: call.input ?? null,
    status: call.status,
    result: call.result ?? null,
    errorKind: call.errorKind,
    errorDetail: call.errorDetail,
    createdAt: call.createdAt.toISOString(),
  };
}

function toDecision(decision: SokoBotPendingDecision): ChatDecision {
  return {
    id: decision.id,
    turnId: decision.turnId,
    toolName: decision.toolName,
    proposal: decision.proposal,
    reason: decision.reason,
    status: decision.status,
    expiresAt: decision.expiresAt.toISOString(),
    resolvedAt: iso(decision.resolvedAt),
    resultingEntityId: decision.resultingEntityId,
    createdAt: decision.createdAt.toISOString(),
  };
}

function toDelegation(delegation: SokoBotDelegation): ChatDelegation {
  return {
    id: delegation.id,
    kind: delegation.kind,
    action: delegation.action,
    outcome: delegation.outcome,
    error: delegation.error,
    taskId: delegation.taskId,
    jobId: delegation.jobId,
  };
}

export function toChatTurn(turn: SokoBotTurn): ChatTurn {
  return {
    id: turn.id,
    source: turn.source,
    status: turn.status,
    route: turn.route,
    userMessage: turn.userMessage,
    finalAnswer: turn.finalAnswer,
    errorKind: turn.errorKind,
    errorDetail: turn.errorDetail,
    startedAt: iso(turn.startedAt),
    completedAt: iso(turn.completedAt),
    durationMs: turn.durationMs,
    createdAt: turn.createdAt.toISOString(),
    events: (turn.events ?? [])
      .map(toEvent)
      .sort((a, b) => a.sequence - b.sequence),
    delegations: (turn.delegations ?? []).map(toDelegation),
    decisions: (turn.pendingDecisions ?? []).map(toDecision),
    requestedBy: turn.requestedBy ?? null,
    chatRoom: turn.chatRoom ?? null,
    qualityScore: turn.qualityScore ?? null,
  };
}

export function toChatTurnDetail(turn: SokoBotTurn): ChatTurnDetail {
  return {
    ...toChatTurn(turn),
    classification: turn.classification,
    classifierModel: turn.classifierModel,
    classifierLatencyMs: turn.classifierLatencyMs,
    classificationFailed: turn.classificationFailed,
    capabilityNames: turn.capabilityNames,
    modelId: turn.modelId,
    usage: turn.usage
      ? {
          inputTokens: turn.usage.inputTokens,
          outputTokens: turn.usage.outputTokens,
          costUsd: turn.usage.costUsd,
        }
      : null,
    toolCalls: (turn.toolCalls ?? []).map(toToolCall),
    contextSummary: turn.contextSummary ?? null,
    contextPacket: turn.contextPacket ?? null,
    versionId: turn.versionId ?? null,
  };
}

function toLegacyMessage(message: SokoBotLegacyMessage): ChatLegacyMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    kind: message.kind,
    stepCount: message.stepCount,
    durationMs: message.durationMs,
    createdAt: message.createdAt.toISOString(),
  };
}

function toSchedule(schedule: SokoBotSchedule): ChatSchedule {
  return {
    id: schedule.id,
    name: schedule.name,
    enabled: schedule.enabled,
    timezone: schedule.timezone,
    cronExpression: schedule.cronExpression,
    prompt: schedule.prompt,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: iso(schedule.lastRunAt),
    consecutiveFailures: schedule.consecutiveFailures,
  };
}

export function toChatBot(bot: SokoBot): ChatBot {
  const memory = bot.memory ?? null;
  return {
    id: bot.id,
    userId: bot.userId,
    name: bot.name,
    avatarSeed: bot.avatarSeed,
    avatarImageUrl: bot.avatarImageUrl ?? null,
    versionId: bot.versionId ?? null,
    coworkerId: bot.coworker?.id ?? null,
    status: bot.status,
    memoryVersion: bot.memoryVersion,
    memory: memory
      ? {
          version: memory.version,
          markdown: memory.markdown,
          createdAt: memory.createdAt.toISOString(),
        }
      : null,
    lastActivityAt: iso(bot.lastActivityAt),
    schedules: (bot.schedules ?? []).map(toSchedule),
    legacyMessages: (bot.legacyMessages ?? []).map(toLegacyMessage),
    pendingDecisions: (bot.pendingDecisions ?? []).map(toDecision),
  };
}

export function toSokoBotChatState(
  bot: SokoBot,
  turns: SokoBotTurn[],
): SokoBotChatState {
  return { bot: toChatBot(bot), turns: turns.map(toChatTurn) };
}
