export type CalendarIdentityLabelState =
  | "current_member"
  | "former_member"
  | "unknown";

export interface CalendarIdentityLabel {
  ref: string;
  state: CalendarIdentityLabelState;
  label?: string;
}

interface CachedCalendarIdentityLabel {
  expiresAt: number;
  value: CalendarIdentityLabel;
}

const CALENDAR_IDENTITY_LABEL_TTL_MS = 5 * 60 * 1000;
const labelsByWorkspace = new Map<
  string,
  Map<string, CachedCalendarIdentityLabel>
>();

export function cacheCalendarIdentityLabels(
  workspaceId: string,
  labels: readonly CalendarIdentityLabel[],
): void {
  const expiresAt = Date.now() + CALENDAR_IDENTITY_LABEL_TTL_MS;
  const workspaceLabels = labelsByWorkspace.get(workspaceId) ?? new Map();
  for (const label of labels) {
    workspaceLabels.set(label.ref, { expiresAt, value: label });
  }
  labelsByWorkspace.set(workspaceId, workspaceLabels);
}

export function getCachedCalendarIdentityLabel(
  workspaceId: string,
  ref: string,
): CalendarIdentityLabel | undefined {
  const workspaceLabels = labelsByWorkspace.get(workspaceId);
  if (!workspaceLabels) {
    return undefined;
  }
  const cached = workspaceLabels.get(ref);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    workspaceLabels.delete(ref);
    if (workspaceLabels.size === 0) {
      labelsByWorkspace.delete(workspaceId);
    }
    return undefined;
  }
  return cached.value;
}

export function clearCalendarIdentityLabelCacheForWorkspace(
  workspaceId: string,
): void {
  labelsByWorkspace.delete(workspaceId);
}
