import type {
  CreateScopedSokoBotRequest,
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  JudgeSokoBotLabTurnRequest,
  ResolveSokoBotDecisionRequest,
  SokoBotLabIngestRequest,
  StartSokoBotTurnRequest,
  UpdateSokoBotScheduleRequest,
} from "@sokosumi/core-client";
import {
  archiveMySokoBot as coreArchiveMySokoBot,
  archiveSokoBot as coreArchiveSokoBot,
  browseSokoBotSkills as coreBrowseSokoBotSkills,
  cancelMySokoBotTurn as coreCancelMySokoBotTurn,
  completeMySokoBotIntegrationAuth as coreCompleteMySokoBotIntegrationAuth,
  completeSokoBotIntegrationAuth as coreCompleteSokoBotIntegrationAuth,
  connectMySokoBotIntegration as coreConnectMySokoBotIntegration,
  connectSokoBotIntegration as coreConnectSokoBotIntegration,
  createMySokoBot as coreCreateMySokoBot,
  createMySokoBotSchedule as coreCreateMySokoBotSchedule,
  createSokoBot as coreCreateSokoBot,
  createSokoBotSchedule as coreCreateSokoBotSchedule,
  deleteMySokoBotPermanently as coreDeleteMySokoBotPermanently,
  deleteMySokoBotSchedule as coreDeleteMySokoBotSchedule,
  deleteSokoBotPermanently as coreDeleteSokoBotPermanently,
  deleteSokoBotSchedule as coreDeleteSokoBotSchedule,
  disconnectMySokoBotIntegration as coreDisconnectMySokoBotIntegration,
  disconnectSokoBotIntegration as coreDisconnectSokoBotIntegration,
  finalizeMySokoBotIntegration as coreFinalizeMySokoBotIntegration,
  getMySokoBot as coreGetMySokoBot,
  getMySokoBotActivity as coreGetMySokoBotActivity,
  getMySokoBotStats as coreGetMySokoBotStats,
  getMySokoBotTurn as coreGetMySokoBotTurn,
  getMySokoBotTurnResults as coreGetMySokoBotTurnResults,
  getMySokoBotUsage as coreGetMySokoBotUsage,
  getSokoBot as coreGetSokoBot,
  getSokoBotActivity as coreGetSokoBotActivity,
  getSokoBotStats as coreGetSokoBotStats,
  getSokoBotTeam as coreGetSokoBotTeam,
  getSokoBotTurn as coreGetSokoBotTurn,
  getSokoBotTurnResults as coreGetSokoBotTurnResults,
  getSokoBotUsage as coreGetSokoBotUsage,
  installMySokoBotSkill as coreInstallMySokoBotSkill,
  introduceMySokoBot as coreIntroduceMySokoBot,
  judgeMySokoBotLabTurn as coreJudgeMySokoBotLabTurn,
  listMySokoBotIntegrations as coreListMySokoBotIntegrations,
  listMySokoBotLabRuns as coreListMySokoBotLabRuns,
  listMySokoBotSkills as coreListMySokoBotSkills,
  listMySokoBotTurns as coreListMySokoBotTurns,
  listSokoBotIntegrations as coreListSokoBotIntegrations,
  listSokoBotTurns as coreListSokoBotTurns,
  listSokoBotVersions as coreListSokoBotVersions,
  removeMySokoBotSkill as coreRemoveMySokoBotSkill,
  resetMySokoBotMemory as coreResetMySokoBotMemory,
  resetSokoBotMemory as coreResetSokoBotMemory,
  resolveMySokoBotDecision as coreResolveMySokoBotDecision,
  resolveSokoBotDecision as coreResolveSokoBotDecision,
  runMySokoBotLabIngest as coreRunMySokoBotLabIngest,
  searchSokoBotIntegrationCatalog as coreSearchSokoBotIntegrationCatalog,
  searchSokoBotSkills as coreSearchSokoBotSkills,
  sendMySokoBotTurnFeedback as coreSendMySokoBotTurnFeedback,
  simulateMySokoBotTaskEvent as coreSimulateMySokoBotTaskEvent,
  startMySokoBotTurn as coreStartMySokoBotTurn,
  startSokoBotTurn as coreStartSokoBotTurn,
  updateMySokoBotBoardFollowing as coreUpdateMySokoBotBoardFollowing,
  updateMySokoBotProactive as coreUpdateMySokoBotProactive,
  updateMySokoBotSchedule as coreUpdateMySokoBotSchedule,
  updateMySokoBotVersion as coreUpdateMySokoBotVersion,
  updateSokoBotBoardFollowing as coreUpdateSokoBotBoardFollowing,
  updateSokoBotProactive as coreUpdateSokoBotProactive,
  updateSokoBotSchedule as coreUpdateSokoBotSchedule,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";
import { createSokoBotAdminClient } from "./core.soko-bot-admin";

export function createSokoBotClient(getClient: GetCoreClient) {
  /** The caller's own bot, or the shared bot `sokoBotId`. */
  async function getMySokoBot(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBot({ client, path: { sokoBotId }, cache: "no-store" })
          : coreGetMySokoBot({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot",
    );
  }

  async function getMySokoBotActivity(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotActivity({
              client,
              path: { sokoBotId },
              cache: "no-store",
            })
          : coreGetMySokoBotActivity({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot activity",
    );
  }

  async function createMySokoBot(body: CreateSokoBotRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreCreateMySokoBot({ client, body }),
      "Failed to create Soko Bot",
    );
  }

  /** Create a bot in a scope: personal, or shared by a project or workspace. */
  async function createSokoBot(body: CreateScopedSokoBotRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreCreateSokoBot({ client, body }),
      "Failed to create Soko Bot",
    );
  }

  async function archiveMySokoBot(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreArchiveSokoBot({ client, path: { sokoBotId } })
          : coreArchiveMySokoBot({ client }),
      "Failed to archive Soko Bot",
    );
  }

  async function deleteMySokoBotPermanently(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreDeleteSokoBotPermanently({ client, path: { sokoBotId } })
          : coreDeleteMySokoBotPermanently({ client }),
      "Failed to delete Soko Bot",
    );
  }

  async function introduceMySokoBot(body: { roomId: string }) {
    return executeCoreOperation(
      getClient,
      (client) => coreIntroduceMySokoBot({ client, body }),
      "Failed to introduce Soko Bot",
    );
  }

  async function listSokoBotVersions() {
    return executeCoreOperation(
      getClient,
      (client) => coreListSokoBotVersions({ client }),
      "Failed to list Soko Bot versions",
    );
  }

  async function updateMySokoBotProactive(
    body: {
      paused?: boolean;
      dailyLimit?: number;
      timezone?: string;
    },
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreUpdateSokoBotProactive({ client, path: { sokoBotId }, body })
          : coreUpdateMySokoBotProactive({ client, body }),
      "Failed to update assistant settings",
    );
  }

  async function sendMySokoBotTurnFeedback(
    turnId: string,
    body: { useful: boolean },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreSendMySokoBotTurnFeedback({ client, path: { id: turnId }, body }),
      "Failed to send feedback",
    );
  }

  async function updateMySokoBotBoardFollowing(
    body: { enabled: boolean },
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreUpdateSokoBotBoardFollowing({
              client,
              path: { sokoBotId },
              body,
            })
          : coreUpdateMySokoBotBoardFollowing({ client, body }),
      "Failed to update board following",
    );
  }

  async function updateMySokoBotVersion(body: { versionId: string }) {
    return executeCoreOperation(
      getClient,
      (client) => coreUpdateMySokoBotVersion({ client, body }),
      "Failed to update Soko Bot version",
    );
  }

  async function getSokoBotTeam() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetSokoBotTeam({ client, cache: "no-store" }),
      "Failed to load the Soko Bot team",
    );
  }

  async function listMySokoBotIntegrations(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreListSokoBotIntegrations({
              client,
              path: { sokoBotId },
              cache: "no-store",
            })
          : coreListMySokoBotIntegrations({ client, cache: "no-store" }),
      "Failed to load Soko Bot integrations",
    );
  }

  async function searchSokoBotIntegrationCatalog(query: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreSearchSokoBotIntegrationCatalog({
          client,
          query: { query },
          cache: "no-store",
        }),
      "Failed to search integrations",
    );
  }

  async function connectMySokoBotIntegration(
    provider: string,
    body: { returnUrl: string },
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreConnectSokoBotIntegration({
              client,
              path: { sokoBotId, provider },
              body,
            })
          : coreConnectMySokoBotIntegration({
              client,
              path: { provider },
              body,
            }),
      "Failed to start the integration",
    );
  }

  async function finalizeMySokoBotIntegration(provider: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreFinalizeMySokoBotIntegration({ client, path: { provider } }),
      "Failed to finish the integration",
    );
  }

  async function completeMySokoBotIntegrationAuth(
    sessionUri: string,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreCompleteSokoBotIntegrationAuth({
              client,
              path: { sokoBotId },
              body: { sessionUri },
            })
          : coreCompleteMySokoBotIntegrationAuth({
              client,
              body: { sessionUri },
            }),
      "Failed to verify the integration",
    );
  }

  async function disconnectMySokoBotIntegration(
    provider: string,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreDisconnectSokoBotIntegration({
              client,
              path: { sokoBotId, provider },
            })
          : coreDisconnectMySokoBotIntegration({ client, path: { provider } }),
      "Failed to disconnect the integration",
    );
  }

  async function runMySokoBotLabIngest(body: SokoBotLabIngestRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreRunMySokoBotLabIngest({ client, body }),
      "Failed to run the scenario",
    );
  }

  async function getMySokoBotStats(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotStats({ client, path: { sokoBotId } })
          : coreGetMySokoBotStats({ client }),
      "Failed to load Soko Bot stats",
    );
  }

  async function getMySokoBotUsage(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotUsage({ client, path: { sokoBotId } })
          : coreGetMySokoBotUsage({ client }),
      "Failed to load Soko Bot usage",
    );
  }

  async function listMySokoBotSkills() {
    return executeCoreOperation(
      getClient,
      (client) => coreListMySokoBotSkills({ client, cache: "no-store" }),
      "Failed to list Soko Bot skills",
    );
  }

  async function installMySokoBotSkill(body: {
    source: string;
    skillName?: string | null;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreInstallMySokoBotSkill({ client, body }),
      "Failed to install Soko Bot skill",
    );
  }

  async function removeMySokoBotSkill(skillId: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreRemoveMySokoBotSkill({ client, path: { skillId } }),
      "Failed to remove Soko Bot skill",
    );
  }

  async function browseSokoBotSkills(page: number) {
    return executeCoreOperation(
      getClient,
      (client) => coreBrowseSokoBotSkills({ client, query: { page } }),
      "Failed to browse skills",
    );
  }

  async function searchSokoBotSkills(q: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreSearchSokoBotSkills({ client, query: { q } }),
      "Failed to search skills",
    );
  }

  async function listMySokoBotLabRuns(query?: {
    versionId?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListMySokoBotLabRuns({ client, query, cache: "no-store" }),
      "Failed to list Soko Bot lab runs",
    );
  }

  async function judgeMySokoBotLabTurn(body: JudgeSokoBotLabTurnRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreJudgeMySokoBotLabTurn({ client, body }),
      "Failed to judge Soko Bot lab turn",
    );
  }

  async function simulateMySokoBotTaskEvent(body: {
    taskId?: string;
    status: "INPUT_REQUIRED" | "FAILED" | "COMPLETED";
    comment: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreSimulateMySokoBotTaskEvent({ client, body }),
      "Failed to simulate Soko Bot task event",
    );
  }

  async function listMySokoBotTurns(
    query?: {
      cursor?: string;
      limit?: number;
    },
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreListSokoBotTurns({
              client,
              path: { sokoBotId },
              query,
              cache: "no-store",
            })
          : coreListMySokoBotTurns({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bot turns",
    );
  }

  async function getMySokoBotTurn(turnId: string, sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotTurn({
              client,
              path: { sokoBotId, turnId },
              cache: "no-store",
            })
          : coreGetMySokoBotTurn({
              client,
              path: { turnId },
              cache: "no-store",
            }),
      "Failed to fetch Soko Bot turn",
    );
  }

  async function startMySokoBotTurn(
    body: StartSokoBotTurnRequest,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreStartSokoBotTurn({ client, path: { sokoBotId }, body })
          : coreStartMySokoBotTurn({ client, body }),
      "Failed to start Soko Bot turn",
    );
  }

  async function cancelMySokoBotTurn(turnId: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreCancelMySokoBotTurn({ client, path: { turnId } }),
      "Failed to cancel Soko Bot turn",
    );
  }

  async function resetMySokoBotMemory(sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreResetSokoBotMemory({ client, path: { sokoBotId } })
          : coreResetMySokoBotMemory({ client }),
      "Failed to reset Soko Bot memory",
    );
  }

  async function createMySokoBotSchedule(
    body: CreateSokoBotScheduleRequest,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreCreateSokoBotSchedule({ client, path: { sokoBotId }, body })
          : coreCreateMySokoBotSchedule({ client, body }),
      "Failed to create Soko Bot schedule",
    );
  }

  async function updateMySokoBotSchedule(
    scheduleId: string,
    body: UpdateSokoBotScheduleRequest,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreUpdateSokoBotSchedule({
              client,
              path: { sokoBotId, scheduleId },
              body,
            })
          : coreUpdateMySokoBotSchedule({
              client,
              path: { scheduleId },
              body,
            }),
      "Failed to update Soko Bot schedule",
    );
  }

  async function deleteMySokoBotSchedule(
    scheduleId: string,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreDeleteSokoBotSchedule({
              client,
              path: { sokoBotId, scheduleId },
            })
          : coreDeleteMySokoBotSchedule({ client, path: { scheduleId } }),
      "Failed to delete Soko Bot schedule",
    );
  }

  async function resolveMySokoBotDecision(
    decisionId: string,
    body: ResolveSokoBotDecisionRequest,
    sokoBotId?: string,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreResolveSokoBotDecision({
              client,
              path: { sokoBotId, decisionId },
              body,
            })
          : coreResolveMySokoBotDecision({
              client,
              path: { decisionId },
              body,
            }),
      "Failed to resolve Soko Bot decision",
    );
  }

  async function getMySokoBotTurnResults(turnId: string, sokoBotId?: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        sokoBotId
          ? coreGetSokoBotTurnResults({
              client,
              path: { sokoBotId, turnId },
              cache: "no-store",
            })
          : coreGetMySokoBotTurnResults({
              client,
              path: { turnId },
              cache: "no-store",
            }),
      "Failed to fetch turn results",
    );
  }

  return {
    ...createSokoBotAdminClient(getClient),
    getMySokoBot,
    getMySokoBotActivity,
    createMySokoBot,
    createSokoBot,
    archiveMySokoBot,
    deleteMySokoBotPermanently,
    introduceMySokoBot,
    listSokoBotVersions,
    updateMySokoBotProactive,
    sendMySokoBotTurnFeedback,
    updateMySokoBotBoardFollowing,
    updateMySokoBotVersion,
    getSokoBotTeam,
    listMySokoBotIntegrations,
    searchSokoBotIntegrationCatalog,
    connectMySokoBotIntegration,
    finalizeMySokoBotIntegration,
    completeMySokoBotIntegrationAuth,
    disconnectMySokoBotIntegration,
    runMySokoBotLabIngest,
    getMySokoBotStats,
    getMySokoBotUsage,
    listMySokoBotSkills,
    installMySokoBotSkill,
    removeMySokoBotSkill,
    browseSokoBotSkills,
    searchSokoBotSkills,
    listMySokoBotLabRuns,
    judgeMySokoBotLabTurn,
    simulateMySokoBotTaskEvent,
    listMySokoBotTurns,
    getMySokoBotTurn,
    startMySokoBotTurn,
    cancelMySokoBotTurn,
    resetMySokoBotMemory,
    createMySokoBotSchedule,
    updateMySokoBotSchedule,
    deleteMySokoBotSchedule,
    resolveMySokoBotDecision,
    getMySokoBotTurnResults,
  };
}
