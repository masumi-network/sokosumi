import type {
  AdminSokoBotActionRequest,
  AdminSokoBotVersionMigrationRequest,
  SokoBotVersionWrite,
} from "@sokosumi/core-client";
import {
  archiveAdminSokoBotVersion as coreArchiveAdminSokoBotVersion,
  createAdminSokoBotVersion as coreCreateAdminSokoBotVersion,
  deleteAdminSokoBot as coreDeleteAdminSokoBot,
  getAdminSokoBot as coreGetAdminSokoBot,
  getAdminSokoBotAvailability as coreGetAdminSokoBotAvailability,
  getAdminSokoBotModelEvaluations as coreGetAdminSokoBotModelEvaluations,
  getAdminSokoBotQuality as coreGetAdminSokoBotQuality,
  getAdminSokoBotVersionUsage as coreGetAdminSokoBotVersionUsage,
  listAdminSokoBotChatMessages as coreListAdminSokoBotChatMessages,
  listAdminSokoBotChats as coreListAdminSokoBotChats,
  listAdminSokoBotGatewayModels as coreListAdminSokoBotGatewayModels,
  listAdminSokoBots as coreListAdminSokoBots,
  listAdminSokoBotVersions as coreListAdminSokoBotVersions,
  migrateAdminSokoBotVersions as coreMigrateAdminSokoBotVersions,
  performAdminSokoBotAction as corePerformAdminSokoBotAction,
  promoteAdminSokoBotVersion as corePromoteAdminSokoBotVersion,
  setAdminSokoBotAvailability as coreSetAdminSokoBotAvailability,
  setAdminSokoBotAvatar as coreSetAdminSokoBotAvatar,
  updateAdminSokoBotVersion as coreUpdateAdminSokoBotVersion,
} from "@sokosumi/core-client";
import { executeCoreOperation, type GetCoreClient } from "./core.request";

/** Operator wrappers for the Soko Bot fleet, versions and kill switch. */
export function createSokoBotAdminClient(getClient: GetCoreClient) {
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

  async function listAdminSokoBots(query?: {
    cursor?: string;
    query?: string;
    limit?: number;
    kind?: "all" | "assistant" | "cmo";
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

  return {
    getAdminSokoBotAvailability,
    setAdminSokoBotAvailability,
    deleteAdminSokoBot,
    setAdminSokoBotAvatar,
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
  };
}
