import type {
  AdminSokoBotActionRequest,
  AdminSokoBotVersionMigrationRequest,
  CreateSokoBotRequest,
  CreateSokoBotScheduleRequest,
  JudgeSokoBotLabTurnRequest,
  ResolveSokoBotDecisionRequest,
  SokoBotLabIngestRequest,
  SokoBotVersionWrite,
  StartSokoBotTurnRequest,
  UpdateSokoBotScheduleRequest,
} from "@sokosumi/core-client";
import {
  archiveAdminSokoBotVersion as coreArchiveAdminSokoBotVersion,
  archiveMySokoBot as coreArchiveMySokoBot,
  browseSokoBotSkills as coreBrowseSokoBotSkills,
  cancelMySokoBotTurn as coreCancelMySokoBotTurn,
  completeMySokoBotIntegrationAuth as coreCompleteMySokoBotIntegrationAuth,
  connectMySokoBotIntegration as coreConnectMySokoBotIntegration,
  createAdminSokoBotVersion as coreCreateAdminSokoBotVersion,
  createMySokoBot as coreCreateMySokoBot,
  createMySokoBotSchedule as coreCreateMySokoBotSchedule,
  deleteAdminSokoBot as coreDeleteAdminSokoBot,
  deleteMySokoBotPermanently as coreDeleteMySokoBotPermanently,
  deleteMySokoBotSchedule as coreDeleteMySokoBotSchedule,
  disconnectMySokoBotIntegration as coreDisconnectMySokoBotIntegration,
  finalizeMySokoBotIntegration as coreFinalizeMySokoBotIntegration,
  getAdminSokoBot as coreGetAdminSokoBot,
  getAdminSokoBotAvailability as coreGetAdminSokoBotAvailability,
  getAdminSokoBotModelEvaluations as coreGetAdminSokoBotModelEvaluations,
  getAdminSokoBotQuality as coreGetAdminSokoBotQuality,
  getAdminSokoBotVersionUsage as coreGetAdminSokoBotVersionUsage,
  getMySokoBot as coreGetMySokoBot,
  getMySokoBotActivity as coreGetMySokoBotActivity,
  getMySokoBotStats as coreGetMySokoBotStats,
  getMySokoBotTurn as coreGetMySokoBotTurn,
  getMySokoBotTurnResults as coreGetMySokoBotTurnResults,
  getMySokoBotUsage as coreGetMySokoBotUsage,
  getSokoBotTeam as coreGetSokoBotTeam,
  installMySokoBotSkill as coreInstallMySokoBotSkill,
  introduceMySokoBot as coreIntroduceMySokoBot,
  judgeMySokoBotLabTurn as coreJudgeMySokoBotLabTurn,
  listAdminSokoBotChatMessages as coreListAdminSokoBotChatMessages,
  listAdminSokoBotChats as coreListAdminSokoBotChats,
  listAdminSokoBotGatewayModels as coreListAdminSokoBotGatewayModels,
  listAdminSokoBots as coreListAdminSokoBots,
  listAdminSokoBotVersions as coreListAdminSokoBotVersions,
  listMySokoBotIntegrations as coreListMySokoBotIntegrations,
  listMySokoBotLabRuns as coreListMySokoBotLabRuns,
  listMySokoBotSkills as coreListMySokoBotSkills,
  listMySokoBotTurns as coreListMySokoBotTurns,
  listSokoBotVersions as coreListSokoBotVersions,
  migrateAdminSokoBotVersions as coreMigrateAdminSokoBotVersions,
  performAdminSokoBotAction as corePerformAdminSokoBotAction,
  promoteAdminSokoBotVersion as corePromoteAdminSokoBotVersion,
  removeMySokoBotSkill as coreRemoveMySokoBotSkill,
  resetMySokoBotMemory as coreResetMySokoBotMemory,
  resolveMySokoBotDecision as coreResolveMySokoBotDecision,
  runMySokoBotLabIngest as coreRunMySokoBotLabIngest,
  searchSokoBotIntegrationCatalog as coreSearchSokoBotIntegrationCatalog,
  searchSokoBotSkills as coreSearchSokoBotSkills,
  sendMySokoBotTurnFeedback as coreSendMySokoBotTurnFeedback,
  setAdminSokoBotAvailability as coreSetAdminSokoBotAvailability,
  setAdminSokoBotAvatar as coreSetAdminSokoBotAvatar,
  simulateMySokoBotTaskEvent as coreSimulateMySokoBotTaskEvent,
  startMySokoBotTurn as coreStartMySokoBotTurn,
  updateAdminSokoBotVersion as coreUpdateAdminSokoBotVersion,
  updateMySokoBotBoardFollowing as coreUpdateMySokoBotBoardFollowing,
  updateMySokoBotProactive as coreUpdateMySokoBotProactive,
  updateMySokoBotSchedule as coreUpdateMySokoBotSchedule,
  updateMySokoBotVersion as coreUpdateMySokoBotVersion,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

export function createSokoBotClient(getClient: GetCoreClient) {
  async function getMySokoBot() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetMySokoBot({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot",
    );
  }

  async function getMySokoBotActivity() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetMySokoBotActivity({ client, cache: "no-store" }),
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

  async function archiveMySokoBot() {
    return executeCoreOperation(
      getClient,
      (client) => coreArchiveMySokoBot({ client }),
      "Failed to archive Soko Bot",
    );
  }

  async function deleteMySokoBotPermanently() {
    return executeCoreOperation(
      getClient,
      (client) => coreDeleteMySokoBotPermanently({ client }),
      "Failed to delete Soko Bot",
    );
  }

  async function getAdminSokoBotAvailability() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminSokoBotAvailability({ client, cache: "no-store" }),
      "Failed to read Soko Bot availability",
    );
  }

  async function setAdminSokoBotAvailability(body: {
    disabled: boolean;
    reason?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreSetAdminSokoBotAvailability({ client, body }),
      "Failed to update Soko Bot availability",
    );
  }

  async function deleteAdminSokoBot(sokoBotId: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreDeleteAdminSokoBot({ client, path: { sokoBotId } }),
      "Failed to delete Soko Bot",
    );
  }

  async function setAdminSokoBotAvatar(sokoBotId: string, avatarId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreSetAdminSokoBotAvatar({
          client,
          path: { sokoBotId },
          body: { avatarId },
        }),
      "Failed to set Soko Bot avatar",
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

  async function updateMySokoBotProactive(body: {
    paused?: boolean;
    dailyLimit?: number;
    timezone?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreUpdateMySokoBotProactive({ client, body }),
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

  async function updateMySokoBotBoardFollowing(body: { enabled: boolean }) {
    return executeCoreOperation(
      getClient,
      (client) => coreUpdateMySokoBotBoardFollowing({ client, body }),
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

  async function listMySokoBotIntegrations() {
    return executeCoreOperation(
      getClient,
      (client) => coreListMySokoBotIntegrations({ client, cache: "no-store" }),
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
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreConnectMySokoBotIntegration({
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

  async function completeMySokoBotIntegrationAuth(sessionUri: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreCompleteMySokoBotIntegrationAuth({ client, body: { sessionUri } }),
      "Failed to verify the integration",
    );
  }

  async function disconnectMySokoBotIntegration(provider: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreDisconnectMySokoBotIntegration({ client, path: { provider } }),
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

  async function getMySokoBotStats() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetMySokoBotStats({ client }),
      "Failed to load Soko Bot stats",
    );
  }

  async function getMySokoBotUsage() {
    return executeCoreOperation(
      getClient,
      (client) => coreGetMySokoBotUsage({ client }),
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

  async function listMySokoBotTurns(query?: {
    cursor?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreListMySokoBotTurns({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bot turns",
    );
  }

  async function getMySokoBotTurn(turnId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetMySokoBotTurn({ client, path: { turnId }, cache: "no-store" }),
      "Failed to fetch Soko Bot turn",
    );
  }

  async function startMySokoBotTurn(body: StartSokoBotTurnRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreStartMySokoBotTurn({ client, body }),
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

  async function resetMySokoBotMemory() {
    return executeCoreOperation(
      getClient,
      (client) => coreResetMySokoBotMemory({ client }),
      "Failed to reset Soko Bot memory",
    );
  }

  async function createMySokoBotSchedule(body: CreateSokoBotScheduleRequest) {
    return executeCoreOperation(
      getClient,
      (client) => coreCreateMySokoBotSchedule({ client, body }),
      "Failed to create Soko Bot schedule",
    );
  }

  async function updateMySokoBotSchedule(
    scheduleId: string,
    body: UpdateSokoBotScheduleRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreUpdateMySokoBotSchedule({ client, path: { scheduleId }, body }),
      "Failed to update Soko Bot schedule",
    );
  }

  async function deleteMySokoBotSchedule(scheduleId: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreDeleteMySokoBotSchedule({ client, path: { scheduleId } }),
      "Failed to delete Soko Bot schedule",
    );
  }

  async function resolveMySokoBotDecision(
    decisionId: string,
    body: ResolveSokoBotDecisionRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreResolveMySokoBotDecision({ client, path: { decisionId }, body }),
      "Failed to resolve Soko Bot decision",
    );
  }

  async function listAdminSokoBots(query?: {
    cursor?: string;
    query?: string;
    limit?: number;
  }) {
    return executeCoreOperation(
      getClient,
      (client) => coreListAdminSokoBots({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bots",
    );
  }

  async function getAdminSokoBotQuality(query?: {
    versionId?: string;
    sokoBotId?: string;
  }) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminSokoBotQuality({ client, query, cache: "no-store" }),
      "Failed to fetch Soko Bot quality",
    );
  }

  async function getAdminSokoBotModelEvaluations() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminSokoBotModelEvaluations({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot model evaluations",
    );
  }

  async function getAdminSokoBot(sokoBotId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminSokoBot({ client, path: { sokoBotId }, cache: "no-store" }),
      "Failed to fetch Soko Bot",
    );
  }

  async function listAdminSokoBotChats(sokoBotId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminSokoBotChats({
          client,
          path: { sokoBotId },
          cache: "no-store",
        }),
      "Failed to fetch Soko Bot chats",
    );
  }

  async function listAdminSokoBotChatMessages(
    sokoBotId: string,
    roomId: string,
    query?: { cursor?: string; limit?: number },
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminSokoBotChatMessages({
          client,
          path: { sokoBotId, roomId },
          query,
          cache: "no-store",
        }),
      "Failed to fetch Soko Bot chat messages",
    );
  }

  async function performAdminSokoBotAction(
    sokoBotId: string,
    body: AdminSokoBotActionRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        corePerformAdminSokoBotAction({ client, path: { sokoBotId }, body }),
      "Failed to perform Soko Bot action",
    );
  }

  async function listAdminSokoBotVersions() {
    return executeCoreOperation(
      getClient,
      (client) => coreListAdminSokoBotVersions({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot versions",
    );
  }

  async function listAdminSokoBotGatewayModels() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreListAdminSokoBotGatewayModels({ client, cache: "no-store" }),
      "Failed to fetch Soko Bot gateway models",
    );
  }

  async function createAdminSokoBotVersion(body: SokoBotVersionWrite) {
    return executeCoreOperation(
      getClient,
      (client) => coreCreateAdminSokoBotVersion({ client, body }),
      "Failed to create Soko Bot version",
    );
  }

  async function updateAdminSokoBotVersion(
    slug: string,
    body: Omit<SokoBotVersionWrite, "slug">,
  ) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreUpdateAdminSokoBotVersion({ client, path: { slug }, body }),
      "Failed to update Soko Bot version",
    );
  }

  async function archiveAdminSokoBotVersion(slug: string) {
    return executeCoreOperation(
      getClient,
      (client) => coreArchiveAdminSokoBotVersion({ client, path: { slug } }),
      "Failed to archive Soko Bot version",
    );
  }

  async function promoteAdminSokoBotVersion(slug: string) {
    return executeCoreOperation(
      getClient,
      (client) => corePromoteAdminSokoBotVersion({ client, path: { slug } }),
      "Failed to promote Soko Bot version",
    );
  }

  async function getAdminSokoBotVersionUsage() {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetAdminSokoBotVersionUsage({ client, cache: "no-store" }),
      "Failed to load Soko Bot version usage",
    );
  }

  async function migrateAdminSokoBotVersions(
    body: AdminSokoBotVersionMigrationRequest,
  ) {
    return executeCoreOperation(
      getClient,
      (client) => coreMigrateAdminSokoBotVersions({ client, body }),
      "Failed to migrate Soko Bot versions",
    );
  }

  async function getMySokoBotTurnResults(turnId: string) {
    return executeCoreOperation(
      getClient,
      (client) =>
        coreGetMySokoBotTurnResults({
          client,
          path: { turnId },
          cache: "no-store",
        }),
      "Failed to fetch turn results",
    );
  }

  return {
    getMySokoBot,
    getMySokoBotActivity,
    createMySokoBot,
    archiveMySokoBot,
    deleteMySokoBotPermanently,
    getAdminSokoBotAvailability,
    setAdminSokoBotAvailability,
    deleteAdminSokoBot,
    setAdminSokoBotAvatar,
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
    listAdminSokoBots,
    getAdminSokoBotQuality,
    getAdminSokoBotModelEvaluations,
    getAdminSokoBot,
    listAdminSokoBotChats,
    listAdminSokoBotChatMessages,
    performAdminSokoBotAction,
    listAdminSokoBotVersions,
    listAdminSokoBotGatewayModels,
    createAdminSokoBotVersion,
    updateAdminSokoBotVersion,
    archiveAdminSokoBotVersion,
    promoteAdminSokoBotVersion,
    getAdminSokoBotVersionUsage,
    migrateAdminSokoBotVersions,
    getMySokoBotTurnResults,
  };
}
