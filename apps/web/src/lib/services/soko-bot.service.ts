import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type {
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  InstallSokoBotSkillResponse,
  JudgeSokoBotLabTurnRequest,
  ResolveSokoBotDecisionRequest,
  SimulateSokoBotTaskEventRequest,
  SokoBot,
  SokoBotAvatar,
  SokoBotDailyStats,
  SokoBotInstalledSkill,
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
  SokoBotLabRun,
  SokoBotLabTaskEvent,
  SokoBotLabVerdict,
  SokoBotSkillBrowse,
  SokoBotSkillSearchResult,
  SokoBotTeam,
  SokoBotTurn,
  SokoBotVersion,
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

  async listVersions(): Promise<SokoBotVersion[]> {
    const response = await coreClient.listSokoBotVersions();
    return response.data;
  },

  async setVersion(versionId: string): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotVersion({ versionId });
    return response.data;
  },

  async getTeam(): Promise<SokoBotTeam> {
    const response = await coreClient.getSokoBotTeam();
    return response.data;
  },

  async listIntegrations(): Promise<SokoBotIntegrations> {
    const response = await coreClient.listMySokoBotIntegrations();
    return response.data;
  },

  async searchIntegrationCatalog(
    query: string,
  ): Promise<SokoBotIntegrationCatalogEntry[]> {
    const response = await coreClient.searchSokoBotIntegrationCatalog(query);
    return response.data;
  },

  async connectIntegration(
    provider: string,
    returnUrl: string,
  ): Promise<{ redirectUrl: string }> {
    const response = await coreClient.connectMySokoBotIntegration(provider, {
      returnUrl,
    });
    return response.data;
  },

  async finalizeIntegration(provider: string): Promise<string> {
    const response = await coreClient.finalizeMySokoBotIntegration(provider);
    return response.data.status;
  },

  async disconnectIntegration(provider: string): Promise<void> {
    await coreClient.disconnectMySokoBotIntegration(provider);
  },

  async getStats(): Promise<SokoBotDailyStats> {
    const response = await coreClient.getMySokoBotStats();
    return response.data;
  },

  async listSkills(): Promise<SokoBotInstalledSkill[]> {
    const response = await coreClient.listMySokoBotSkills();
    return response.data;
  },

  async installSkill(input: {
    source: string;
    skillName?: string | null;
  }): Promise<InstallSokoBotSkillResponse> {
    const response = await coreClient.installMySokoBotSkill(input);
    return response.data;
  },

  async removeSkill(skillId: string): Promise<void> {
    await coreClient.removeMySokoBotSkill(skillId);
  },

  async browseSkills(page: number): Promise<SokoBotSkillBrowse> {
    const response = await coreClient.browseSokoBotSkills(page);
    return response.data;
  },

  async searchSkills(q: string): Promise<SokoBotSkillSearchResult[]> {
    const response = await coreClient.searchSokoBotSkills(q);
    return response.data;
  },

  async listLabRuns(versionId?: string): Promise<SokoBotLabRun[]> {
    const response = await coreClient.listMySokoBotLabRuns({ versionId });
    return response.data;
  },

  async judgeLabTurn(
    input: JudgeSokoBotLabTurnRequest,
  ): Promise<SokoBotLabVerdict> {
    const response = await coreClient.judgeMySokoBotLabTurn(input);
    return response.data;
  },

  async simulateTaskEvent(
    input: SimulateSokoBotTaskEventRequest,
  ): Promise<SokoBotLabTaskEvent> {
    const response = await coreClient.simulateMySokoBotTaskEvent(input);
    return response.data;
  },

  /** Posts the bot's first message in its direct room (once). */
  async introduce(roomId: string): Promise<{ messageId: string }> {
    const response = await coreClient.introduceMySokoBot({ roomId });
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
