import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  ResolveSokoBotDecisionRequest,
  SokoBot,
  SokoBotAutonomyLevel,
  SokoBotTurn,
  StartSokoBotTurnRequest,
  UpdateSokoBotScheduleRequest,
} from "@/lib/clients/generated/core";

/** Turns the chat surface renders and polls; keeps one Core round-trip small. */
export const SOKO_BOT_RECENT_TURN_LIMIT = 20;

/** Cheap change token for polling; the page only re-renders when it moves. */
export interface SokoBotTurnStatusSnapshot {
  turnId: string;
  status: SokoBotTurn["status"];
  fingerprint: string;
}

export function turnStatusSnapshot(
  turn: SokoBotTurn,
): SokoBotTurnStatusSnapshot {
  return {
    turnId: turn.id,
    status: turn.status,
    fingerprint: [
      turn.status,
      turn.updatedAt.toISOString(),
      turn.events?.length ?? 0,
      turn.delegations?.length ?? 0,
      turn.pendingDecisions?.length ?? 0,
      turn.finalAnswer?.length ?? 0,
    ].join(":"),
  };
}

/**
 * Signed-in user's Soko Bot. All reads/writes go through Core; web never
 * touches the database. Returned shapes are Core DTOs.
 */
export const sokoBotService = {
  /** Active (non-archived) bot for the signed-in user, or `null`. */
  async getMine(): Promise<SokoBot | null> {
    const response = await coreClient.getMySokoBot();
    return (response.data.sokoBot as SokoBot | null) ?? null;
  },

  /**
   * Create the user's bot, or reactivate/update an archived or existing one.
   * Core upserts on `userId`, so this doubles as the autonomy/identity update.
   */
  async createOrUpdate(input: CreateSokoBotRequest): Promise<SokoBot> {
    const response = await coreClient.createMySokoBot(input);
    return response.data;
  },

  /** Update autonomy while keeping identity fields as they are. */
  async updateAutonomy(
    current: SokoBot,
    autonomyLevel: SokoBotAutonomyLevel,
  ): Promise<SokoBot> {
    return this.createOrUpdate({
      name: current.name ?? "Soko Bot",
      avatarSeed: current.avatarSeed,
      personalityTone: current.personalityTone,
      personalityDetail: current.personalityDetail,
      personalityStyle: current.personalityStyle,
      autonomyLevel,
    });
  },

  async archive(): Promise<void> {
    await coreClient.archiveMySokoBot();
  },

  async listTurns(limit = SOKO_BOT_RECENT_TURN_LIMIT): Promise<SokoBotTurn[]> {
    const response = await coreClient.listMySokoBotTurns({ limit });
    return response.data;
  },

  async getTurn(turnId: string): Promise<SokoBotTurn> {
    const response = await coreClient.getMySokoBotTurn(turnId);
    return response.data;
  },

  /** Narrow status snapshots for the client poller (max 20 turns). */
  async getTurnStatuses(
    turnIds: string[],
  ): Promise<SokoBotTurnStatusSnapshot[]> {
    const turns = await Promise.all(
      turnIds.slice(0, 20).map((turnId) => this.getTurn(turnId)),
    );
    return turns.map(turnStatusSnapshot);
  },

  async startTurn(input: StartSokoBotTurnRequest) {
    const response = await coreClient.startMySokoBotTurn(input);
    return response.data;
  },

  async cancelTurn(turnId: string): Promise<void> {
    await coreClient.cancelMySokoBotTurn(turnId);
  },

  async resetMemory() {
    const response = await coreClient.resetMySokoBotMemory();
    return response.data;
  },

  async createSchedule(input: CreateSokoBotScheduleRequest) {
    const response = await coreClient.createMySokoBotSchedule(input);
    return response.data;
  },

  async updateSchedule(
    scheduleId: string,
    input: UpdateSokoBotScheduleRequest,
  ) {
    const response = await coreClient.updateMySokoBotSchedule(
      scheduleId,
      input,
    );
    return response.data;
  },

  async deleteSchedule(scheduleId: string): Promise<void> {
    await coreClient.deleteMySokoBotSchedule(scheduleId);
  },

  async resolveDecision(
    decisionId: string,
    input: ResolveSokoBotDecisionRequest,
  ) {
    const response = await coreClient.resolveMySokoBotDecision(
      decisionId,
      input,
    );
    return response.data;
  },
};
