export interface WorkspaceReadScope {
  workspaceId: string;
  userId: string;
  organizationId: string | null;
}

export interface WorkspaceScopedRecord {
  workspaceId: string;
  userId: string;
}

export function buildWorkspaceReadWhere(
  scope: WorkspaceReadScope,
  memberUserId?: string,
): {
  workspaceId: string;
  userId?: string;
} {
  const userId = scope.organizationId ? memberUserId : scope.userId;

  return {
    workspaceId: scope.workspaceId,
    ...(userId ? { userId } : {}),
  };
}

export function canReadWorkspaceScopedRecord(
  record: WorkspaceScopedRecord,
  scope: WorkspaceReadScope,
  memberUserId?: string,
): boolean {
  if (record.workspaceId !== scope.workspaceId) {
    return false;
  }

  const scopedUserId = scope.organizationId ? memberUserId : scope.userId;
  if (!scopedUserId) {
    return true;
  }

  return record.userId === scopedUserId;
}
