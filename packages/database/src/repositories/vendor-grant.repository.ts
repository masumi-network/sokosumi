import { SERVICEPLAN_VENDOR_ID } from "../constants/vendor.js";
import {
  type Prisma,
  VendorGrantStatus,
  VendorPermission,
} from "../generated/prisma/client.js";

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

const serviceplanGrantCheckedWorkspaceIds = new Set<string>();

function markServiceplanGrantChecked(workspaceId: string): void {
  serviceplanGrantCheckedWorkspaceIds.add(workspaceId);
}

export const vendorGrantRepository = {
  clearServiceplanGrantWorkspaceCacheForTests(): void {
    serviceplanGrantCheckedWorkspaceIds.clear();
  },
  /**
   * Grants Serviceplan workspace access when a workspace is first created.
   * Skips when a grant row already exists so user denials/revocations are preserved.
   * In-process cache is a perf hint only; entries are set for committed reads (existing
   * row or unique race), never for uncommitted creates.
   */
  async ensureServiceplanWorkspaceGrantOnCreate({
    workspaceId,
    resolvedByUserId,
    tx,
  }: {
    workspaceId: string;
    resolvedByUserId: string | null;
    tx: Prisma.TransactionClient;
  }): Promise<void> {
    if (serviceplanGrantCheckedWorkspaceIds.has(workspaceId)) {
      return;
    }

    const existingGrant = await tx.vendorGrant.findUnique({
      where: {
        vendorId_workspaceId: {
          vendorId: SERVICEPLAN_VENDOR_ID,
          workspaceId,
        },
      },
      select: { id: true },
    });

    if (existingGrant) {
      markServiceplanGrantChecked(workspaceId);
      return;
    }

    const vendor = await tx.vendor.findUnique({
      where: { id: SERVICEPLAN_VENDOR_ID },
      select: { id: true },
    });

    if (!vendor) {
      return;
    }

    const now = new Date();

    try {
      await tx.vendorGrant.create({
        data: {
          vendorId: SERVICEPLAN_VENDOR_ID,
          workspaceId,
          permission: VendorPermission.workspace,
          status: VendorGrantStatus.GRANTED,
          resolvedAt: now,
          resolvedById: resolvedByUserId,
        },
      });
      // Do not cache here: outer transaction may still roll back.
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        markServiceplanGrantChecked(workspaceId);
        return;
      }

      throw error;
    }
  },
};
