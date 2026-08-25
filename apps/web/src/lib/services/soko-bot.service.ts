import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  ResolveSokoBotDecisionRequest,
  SimulateSokoBotTaskEventRequest,
  SokoBot,
  SokoBotAvatar,
  SokoBotLabTaskEvent,
  SokoBotPreset,
  SokoBotTurn,
  StartSokoBotTurnRequest,
  UpdateSokoBotScheduleRequest,
} from "@/lib/clients/generated/core";
import {
  type SokoBotChatState,
  toSokoBotChatState,
} from "@/lib/soko-bot/chat-state";

/** Turns the chat surface renders and polls; keeps one Core round-trip small. */
export const SOKO_BOT_RECENT_TURN_LIMIT = 20;

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
   * Core upserts on `userId`, so this doubles as the identity update.
   */
  async createOrUpdate(input: CreateSokoBotRequest): Promise<SokoBot> {
    const response = await coreClient.createMySokoBot(input);
    return response.data;
  },

  async archive(): Promise<void> {
    await coreClient.archiveMySokoBot();
  },

  async listAvatars(
    take: number,
    excludeIds: string[],
  ): Promise<SokoBotAvatar[]> {
    const response = await coreClient.listSokoBotAvatars({
      take,
      exclude: excludeIds.length > 0 ? excludeIds.join(",") : undefined,
    });
    return response.data;
  },

  async listPresets(): Promise<SokoBotPreset[]> {
    const response = await coreClient.listSokoBotPresets();
    return response.data;
  },

  async setPreset(presetId: string): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotPreset({ presetId });
    return response.data;
  },

  async simulateTaskEvent(
    input: SimulateSokoBotTaskEventRequest,
  ): Promise<SokoBotLabTaskEvent> {
    const response = await coreClient.simulateMySokoBotTaskEvent(input);
    return response.data;
  },

  async claimAvatar(avatarId: string): Promise<SokoBot> {
    const response = await coreClient.claimMySokoBotAvatar({ avatarId });
    return response.data;
  },

  /** Bot + recent turns as the JSON-safe chat projection; `null` without a bot. */
  async getChatState(): Promise<SokoBotChatState | null> {
    const bot = await this.getMine();
    if (!bot) return null;
    const turns = await this.listTurns();
    return toSokoBotChatState(bot, turns);
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
