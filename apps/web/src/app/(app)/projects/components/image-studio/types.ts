import type {
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageSession,
  ProjectImageStudioState,
} from "@/lib/clients/generated/core/types.gen";

export type StudioAsset = ProjectImageAsset;
export type StudioJob = ProjectImageJob;
export type StudioSession = ProjectImageSession;
export type StudioState = ProjectImageStudioState;

/** Job statuses that are still going somewhere. */
export const ACTIVE_JOB_STATUSES: readonly StudioJob["status"][] = [
  "PENDING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
];

export function isActive(job: StudioJob): boolean {
  return ACTIVE_JOB_STATUSES.includes(job.status);
}

export function assetContentUrl(projectId: string, assetId: string): string {
  return `/api/projects/${projectId}/image-studio/assets/${assetId}/content`;
}

export interface StudioLabels {
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyBody: string;
  examplePrompts: string[];
  promptPlaceholder: string;
  generate: string;
  refine: string;
  regenerate: string;
  variations: string;
  download: string;
  compare: string;
  compareOff: string;
  approve: string;
  reject: string;
  undecided: string;
  approved: string;
  rejected: string;
  clearReview: string;
  feedbackPlaceholder: string;
  history: string;
  version: string;
  generating: string;
  queued: string;
  failed: string;
  uncertainTitle: string;
  uncertainBody: string;
  checkAgain: string;
  submitAnyway: string;
  tryAgain: string;
  cancel: string;
  cancelRequested: string;
  chatTitle: string;
  chatUnavailable: string;
  send: string;
  noApproved: string;
  clearFilter: string;
  filterAll: string;
  filterApproved: string;
  elapsed: string;
  lineage: string;
  from: string;
  you: string;
  studio: string;
  thinking: string;
  assistantError: string;
  assistantErrorHint: string;
  bindWarning: string;
  loadOlder: string;
}
