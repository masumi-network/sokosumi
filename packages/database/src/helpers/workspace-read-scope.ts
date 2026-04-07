export interface WorkspaceReadScope {
  workspaceId: string;
  ownerUserId: string | null;
}

export interface WorkspaceScopedRecord {
  workspaceId: string;
  userId: string;
}

export function buildWorkspaceReadWhere(
  scope: WorkspaceReadScope,
  userId?: string,
): {
  workspaceId: string;
  userId?: string;
} {
  return {
    workspaceId: scope.workspaceId,
    ...(scope.ownerUserId
      ? {
          userId: scope.ownerUserId,
        }
      : userId
        ? {
            userId,
          }
        : {}),
  };
}

export function canReadWorkspaceScopedRecord(
  record: WorkspaceScopedRecord,
  scope: WorkspaceReadScope,
  userId?: string,
): boolean {
  if (record.workspaceId !== scope.workspaceId) {
    return false;
  }

  const scopedUserId = scope.ownerUserId ?? userId;
  if (!scopedUserId) {
    return true;
  }

  return record.userId === scopedUserId;
}
