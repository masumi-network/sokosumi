import type { OrbState } from "thinking-orbs";

import type {
  ChatDecision,
  ChatTurn,
  ChatTurnEvent,
  SokoBotChatState,
} from "@/lib/soko-bot/chat-state";
import { ACTIVE_SOKO_BOT_TURN_STATUSES } from "@/lib/soko-bot/constants";

export function isActiveTurn(turn: Pick<ChatTurn, "status">): boolean {
  return ACTIVE_SOKO_BOT_TURN_STATUSES.has(turn.status);
}

export function hasActiveTurn(state: SokoBotChatState): boolean {
  return state.turns.some(isActiveTurn);
}

/** Decisions still waiting on the user, across the bot and its turns. */
export function pendingDecisionCount(state: SokoBotChatState): number {
  const ids = new Set<string>();
  for (const decision of state.bot.pendingDecisions) {
    if (decision.status === "PENDING") ids.add(decision.id);
  }
  for (const turn of state.turns) {
    for (const decision of turn.decisions) {
      if (decision.status === "PENDING") ids.add(decision.id);
    }
  }
  return ids.size;
}

/** Turns oldest-first for the timeline; Core returns them newest-first. */
export function orderedTurns(state: SokoBotChatState): ChatTurn[] {
  return [...state.turns].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
}

/**
 * Bot-level decisions that no rendered turn owns (turn paged out of the
 * recent window). Rendered as a standalone card so nothing pending is hidden.
 */
export function orphanPendingDecisions(
  state: SokoBotChatState,
): ChatDecision[] {
  const owned = new Set(state.turns.map((turn) => turn.id));
  return state.bot.pendingDecisions.filter(
    (decision) => decision.status === "PENDING" && !owned.has(decision.turnId),
  );
}

export interface ProgressChip {
  id: string;
  toolName: string | null;
  done: boolean;
}

/**
 * Tool activity for one turn, in call order. `actions.requested` opens a
 * chip; the matching `action.result` (by call id, else the oldest open chip
 * for that tool) closes it. Reasoning/message events carry no chip.
 */
export function progressChipsForTurn(turn: ChatTurn): ProgressChip[] {
  const chips: ProgressChip[] = [];
  for (const event of turn.events) {
    if (event.type === "actions.requested" && event.toolName) {
      chips.push({
        id: event.toolName + (chips.length + 1),
        toolName: event.toolName,
        done: false,
      });
      continue;
    }
    if (event.type === "action.result") {
      const open = chips.find(
        (chip) =>
          !chip.done && (!event.toolName || chip.toolName === event.toolName),
      );
      if (open) open.done = true;
    }
  }
  return chips;
}

/** Thinking-orb activity derived from the newest runtime event. */
export function orbStateForTurn(turn: ChatTurn): OrbState {
  const last = turn.events.at(-1);
  if (!last) return "solving";
  return orbStateForEvent(last);
}

function orbStateForEvent(event: ChatTurnEvent): OrbState {
  if (event.type === "actions.requested") return "searching";
  if (event.type === "action.result") return "working";
  if (event.type.startsWith("message.")) return "composing";
  return "solving";
}

/** Steps kept in the answer's disclosure once a turn has finished. */
export function completedStepsForTurn(turn: ChatTurn): ProgressChip[] {
  return progressChipsForTurn(turn);
}

/** Whether a scheduled or operator-triggered turn should carry a kind chip. */
export function turnKind(
  turn: ChatTurn,
): "scheduled" | "retry" | "event" | null {
  if (turn.source === "SCHEDULE") return "scheduled";
  if (turn.source === "ADMIN_RETRY") return "retry";
  if (turn.source === "EVENT") return "event";
  return null;
}
