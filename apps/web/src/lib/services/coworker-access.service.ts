import "server-only";

import { coreClient } from "@/lib/clients/core.client";
import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

export type CoworkerAccessScope =
  | { type: "personal" }
  | { type: "organization"; organizationId: string };

export const coworkerAccessService = (() => {
  async function listForPersonalWorkspace(): Promise<
    CoworkerWorkspaceAccess[]
  > {
    const { data } = await coreClient.getMyCoworkerAccess();
    return data;
  }

  async function listForOrganization(
    organizationId: string,
  ): Promise<CoworkerWorkspaceAccess[]> {
    const { data } =
      await coreClient.getOrganizationCoworkerAccess(organizationId);
    return data;
  }

  async function approve(
    accessId: string,
    scope: CoworkerAccessScope,
  ): Promise<CoworkerWorkspaceAccess> {
    if (scope.type === "organization") {
      const { data } = await coreClient.approveOrganizationCoworkerAccess(
        scope.organizationId,
        accessId,
      );
      return data;
    }

    const { data } = await coreClient.approveMyCoworkerAccess(accessId);
    return data;
  }

  async function deny(
    accessId: string,
    scope: CoworkerAccessScope,
  ): Promise<CoworkerWorkspaceAccess> {
    if (scope.type === "organization") {
      const { data } = await coreClient.denyOrganizationCoworkerAccess(
        scope.organizationId,
        accessId,
      );
      return data;
    }

    const { data } = await coreClient.denyMyCoworkerAccess(accessId);
    return data;
  }

  async function revoke(
    accessId: string,
    scope: CoworkerAccessScope,
  ): Promise<CoworkerWorkspaceAccess> {
    if (scope.type === "organization") {
      const { data } = await coreClient.revokeOrganizationCoworkerAccess(
        scope.organizationId,
        accessId,
      );
      return data;
    }

    const { data } = await coreClient.revokeMyCoworkerAccess(accessId);
    return data;
  }

  async function createForCoworker(
    coworkerId: string,
    target:
      | { workspaceId: string }
      | { userId: string }
      | { organizationId: string }
      | { email: string }
      | { organizationSlug: string },
  ): Promise<CoworkerWorkspaceAccess> {
    const { data } = await coreClient.createCoworkerWorkspaceAccess(
      coworkerId,
      target,
    );
    return data;
  }

  async function forceRevokeForCoworker(
    coworkerId: string,
    target:
      | { workspaceId: string }
      | { userId: string }
      | { organizationId: string }
      | { email: string }
      | { organizationSlug: string },
  ): Promise<CoworkerWorkspaceAccess> {
    const { data } =
      await coreClient.revokeCoworkerWorkspaceAccessAsPlatformAdmin(
        coworkerId,
        target,
      );
    return data;
  }

  async function listForCoworker(
    coworkerId: string,
  ): Promise<CoworkerWorkspaceAccess[]> {
    const { data } = await coreClient.listCoworkerWorkspaceAccess(coworkerId);
    return data;
  }

  return {
    listForPersonalWorkspace,
    listForOrganization,
    approve,
    deny,
    revoke,
    createForCoworker,
    forceRevokeForCoworker,
    listForCoworker,
  };
})();
