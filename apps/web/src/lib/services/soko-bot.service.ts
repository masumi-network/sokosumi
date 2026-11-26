import "server-only";

import type {
  AddedSokoBotMcpServer,
  AddSokoBotMcpServerRequest,
  CreateScopedSokoBotRequest,
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  InstallSokoBotSkillResponse,
  JudgeSokoBotLabTurnRequest,
  ResolveSokoBotDecisionRequest,
  SharedSokoBotSummary,
  SimulateSokoBotTaskEventRequest,
  SokoBot,
  SokoBotConversation,
  SokoBotDailyStats,
  SokoBotInstalledSkill,
  SokoBotIntegrationCatalogEntry,
  SokoBotIntegrations,
  SokoBotLabIngestRequest,
  SokoBotLabRun,
  SokoBotLabTaskEvent,
  SokoBotLabVerdict,
  SokoBotMcpServer,
  SokoBotSecret,
  SokoBotSkillBrowse,
  SokoBotSkillSearchResult,
  SokoBotState,
  SokoBotTeam,
  SokoBotTurn,
  SokoBotUsage,
  SokoBotVersion,
  StartSokoBotTurnRequest,
  UpdateSokoBotScheduleRequest,
} from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";
import {
  type SokoBotChatState,
  toSokoBotChatState,
} from "@/lib/soko-bot/chat-state";
import {
  connectOffers,
  type SokoBotConnectPromptState,
} from "@/lib/soko-bot/connect-prompt";

/** Turns the chat surface renders and polls; keeps one Core round-trip small. */
const SOKO_BOT_RECENT_TURN_LIMIT = 20;

/**
 * Signed-in user's Soko Bot. All reads/writes go through Core; web never
 * touches the database. Returned shapes are Core DTOs.
 */
export const sokoBotService = {
  /**
   * Active (non-archived) bot for the signed-in user, or `null`. With
   * `botId`, the project or workspace bot of that id instead.
   */
  async getMine(botId?: string): Promise<SokoBot | null> {
    const response = await coreClient.getMySokoBot(botId);
    return (response.data.sokoBot as SokoBot | null) ?? null;
  },

  /**
   * Your bot and, while it is in error, where its last failure happened
   * (`lastFailure`, the failed reply in a room you belong to, or nulls).
   */
  async getMineWithLastFailure(): Promise<{
    sokoBot: SokoBot | null;
    lastFailure: SokoBotState["lastFailure"] | null;
  }> {
    const response = await coreClient.getMySokoBot();
    return {
      sokoBot: (response.data.sokoBot as SokoBot | null) ?? null,
      lastFailure: response.data.lastFailure ?? null,
    };
  },

  /**
   * The workspace's project and workspace bots. `null` when Core leaves the
   * field out (a Soko Bot key caller) or the read fails: the caller then
   * shows no shared-bot surface at all.
   */
  async listShared(): Promise<SharedSokoBotSummary[] | null> {
    const response = await coreClient.getMySokoBot();
    return response.data.sharedBots ?? null;
  },

  /** Create a bot in a scope; any member may create a shared one. */
  async createScoped(input: CreateScopedSokoBotRequest): Promise<SokoBot> {
    const response = await coreClient.createSokoBot(input);
    return response.data;
  },

  /**
   * What the bot has spent since it was created. Its own call rather than a
   * field on `getMine`, which is polled for turn state while this aggregates
   * every turn the bot has taken.
   */
  async getMyUsage(botId?: string): Promise<SokoBotUsage> {
    const response = await coreClient.getMySokoBotUsage(botId);
    return response.data;
  },

  /**
   * Create the user's bot, or reactivate/update an archived or existing one.
   * Core upserts on `userId`, so this doubles as the identity update.
   */
  async createOrUpdate(input: CreateSokoBotRequest): Promise<SokoBot> {
    const response = await coreClient.createMySokoBot(input);
    return response.data;
  },

  async archive(botId?: string): Promise<void> {
    await coreClient.archiveMySokoBot(botId);
  },

  /** Brings an archived shared bot back, into its room. */
  async reactivate(botId: string): Promise<void> {
    await coreClient.reactivateSokoBot(botId);
  },

  /**
   * Irreversible. The bot's history, memory, schedules and integrations are
   * erased and the owner can create a brand-new bot straight after. Returns
   * whether the row itself went away or had to stay as a tombstone because
   * Tasks, billing or chat still reference it.
   */
  async deletePermanently(botId?: string) {
    const response = await coreClient.deleteMySokoBotPermanently(botId);
    return response.data;
  },

  async listVersions(): Promise<SokoBotVersion[]> {
    const response = await coreClient.listSokoBotVersions();
    return response.data;
  },

  async updateProactive(
    input: {
      paused?: boolean;
      dailyLimit?: number;
      timezone?: string;
      mailAutoRead?: boolean;
    },
    botId?: string,
  ): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotProactive(input, botId);
    return response.data;
  },

  async getTurnConversation(turnId: string): Promise<SokoBotConversation> {
    const response = await coreClient.getMySokoBotTurnConversation(turnId);
    return response.data;
  },

  async sendTurnFeedback(turnId: string, useful: boolean): Promise<void> {
    await coreClient.sendMySokoBotTurnFeedback(turnId, { useful });
  },

  async setFollowBoard(enabled: boolean, botId?: string): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotBoardFollowing(
      { enabled },
      botId,
    );
    return response.data;
  },

  async setJoinsTeamStandup(
    enabled: boolean,
    botId?: string,
  ): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotTeamStandup(
      { enabled },
      botId,
    );
    return response.data;
  },

  async rename(name: string, botId?: string): Promise<SokoBot> {
    const response = await coreClient.renameMySokoBot({ name }, botId);
    return response.data;
  },

  /**
   * Behaviour lab: run one proactive rhythm now, the way the cron would.
   * Rejects with the Core message when the beat reads an account the bot has
   * not connected.
   */
  async runLabIngest(beat: SokoBotLabIngestRequest["beat"]): Promise<string> {
    const response = await coreClient.runMySokoBotLabIngest({ beat });
    return response.data.turnId;
  },

  async setVersion(versionId: string): Promise<SokoBot> {
    const response = await coreClient.updateMySokoBotVersion({ versionId });
    return response.data;
  },

  async getTeam(): Promise<SokoBotTeam> {
    const response = await coreClient.getSokoBotTeam();
    return response.data;
  },

  async listIntegrations(botId?: string): Promise<SokoBotIntegrations> {
    const response = await coreClient.listMySokoBotIntegrations(botId);
    return response.data;
  },

  /**
   * Null when there is no bot, integrations are off, or nothing is missing.
   * `untilAnyConnected` also hides it once any integration is connected.
   */
  async getConnectPromptState({
    untilAnyConnected = false,
  }: {
    untilAnyConnected?: boolean;
  } = {}): Promise<SokoBotConnectPromptState | null> {
    const [bot, { configured, integrations }] = await Promise.all([
      this.getMine(),
      this.listIntegrations(),
    ]);
    if (!bot || !configured) return null;
    if (untilAnyConnected && integrations.some((i) => i.status === "ACTIVE"))
      return null;
    const offers = connectOffers(integrations);
    return offers.length > 0
      ? { botId: bot.id, botName: bot.name ?? "Soko Bot", offers }
      : null;
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
    botId?: string,
  ): Promise<{ redirectUrl: string }> {
    const response = await coreClient.connectMySokoBotIntegration(
      provider,
      { returnUrl },
      botId,
    );
    return response.data;
  },

  async finalizeIntegration(provider: string): Promise<string> {
    const response = await coreClient.finalizeMySokoBotIntegration(provider);
    return response.data.status;
  },

  async completeIntegrationAuth(
    sessionUri: string,
    botId?: string,
  ): Promise<{ provider: string; status: string }> {
    const response = await coreClient.completeMySokoBotIntegrationAuth(
      sessionUri,
      botId,
    );
    return response.data;
  },

  async disconnectIntegration(provider: string, botId?: string): Promise<void> {
    await coreClient.disconnectMySokoBotIntegration(provider, botId);
  },

  async getStats(botId?: string): Promise<SokoBotDailyStats> {
    const response = await coreClient.getMySokoBotStats(botId);
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

  async listSecrets(botId: string): Promise<SokoBotSecret[]> {
    return (await coreClient.listSokoBotSecrets(botId)).data;
  },

  async saveSecret(
    botId: string,
    name: string,
    input: { value?: string; shellAccess?: boolean },
  ): Promise<SokoBotSecret> {
    return (await coreClient.saveSokoBotSecret(botId, name, input)).data;
  },

  async deleteSecret(botId: string, name: string): Promise<void> {
    await coreClient.deleteSokoBotSecret(botId, name);
  },

  async getSandboxSetup(botId: string): Promise<string[]> {
    return (await coreClient.getSokoBotSandboxSetup(botId)).data.commands;
  },

  async setSandboxSetup(botId: string, commands: string[]): Promise<string[]> {
    return (await coreClient.setSokoBotSandboxSetup(botId, commands)).data
      .commands;
  },

  async listMcpServers(botId: string): Promise<SokoBotMcpServer[]> {
    return (await coreClient.listSokoBotMcpServers(botId)).data;
  },

  async addMcpServer(
    botId: string,
    input: AddSokoBotMcpServerRequest,
  ): Promise<AddedSokoBotMcpServer> {
    return (await coreClient.addSokoBotMcpServer(botId, input)).data;
  },

  async refreshMcpServer(
    botId: string,
    serverId: string,
  ): Promise<SokoBotMcpServer> {
    return (await coreClient.refreshSokoBotMcpServer(botId, serverId)).data;
  },

  async signInToMcpServer(
    botId: string,
    serverId: string,
  ): Promise<string | null> {
    return (await coreClient.signInToSokoBotMcpServer(botId, serverId)).data
      .authorizationUrl;
  },

  async updateMcpTool(
    botId: string,
    serverId: string,
    change: { name: string; enabled?: boolean; readOnly?: boolean },
  ): Promise<SokoBotMcpServer> {
    return (await coreClient.updateSokoBotMcpTool(botId, serverId, change))
      .data;
  },

  async removeMcpServer(botId: string, serverId: string): Promise<void> {
    await coreClient.removeSokoBotMcpServer(botId, serverId);
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

  async setAvatarCode(code: string, botId?: string) {
    const response = await coreClient.setSokoBotAvatarCode(code, botId);
    return response.data;
  },

  /** Bot + recent turns as the JSON-safe chat projection; `null` without a bot. */
  async getChatState(botId?: string): Promise<SokoBotChatState | null> {
    // Both reads are independent; running them in series added a whole Core
    // round-trip to every assistant page load.
    const [bot, turns] = await Promise.all([
      this.getMine(botId),
      this.listTurns(SOKO_BOT_RECENT_TURN_LIMIT, botId),
    ]);
    if (!bot) return null;
    return toSokoBotChatState(bot, turns);
  },

  async listTurns(
    limit = SOKO_BOT_RECENT_TURN_LIMIT,
    botId?: string,
  ): Promise<SokoBotTurn[]> {
    const response = await coreClient.listMySokoBotTurns({ limit }, botId);
    return response.data;
  },

  async getTurn(turnId: string, botId?: string): Promise<SokoBotTurn> {
    const response = await coreClient.getMySokoBotTurn(turnId, botId);
    return response.data;
  },

  /** Narrow status snapshots for the client poller (max 20 turns). */
  async startTurn(input: StartSokoBotTurnRequest, botId?: string) {
    const response = await coreClient.startMySokoBotTurn(input, botId);
    return response.data;
  },

  async resetMemory(botId?: string) {
    const response = await coreClient.resetMySokoBotMemory(botId);
    return response.data;
  },

  async createSchedule(input: CreateSokoBotScheduleRequest, botId?: string) {
    const response = await coreClient.createMySokoBotSchedule(input, botId);
    return response.data;
  },

  async updateSchedule(
    scheduleId: string,
    input: UpdateSokoBotScheduleRequest,
    botId?: string,
  ) {
    const response = await coreClient.updateMySokoBotSchedule(
      scheduleId,
      input,
      botId,
    );
    return response.data;
  },

  async deleteSchedule(scheduleId: string, botId?: string): Promise<void> {
    await coreClient.deleteMySokoBotSchedule(scheduleId, botId);
  },

  async resolveDecision(
    decisionId: string,
    input: ResolveSokoBotDecisionRequest,
    botId?: string,
  ) {
    const response = await coreClient.resolveMySokoBotDecision(
      decisionId,
      input,
      botId,
    );
    return response.data;
  },
};
