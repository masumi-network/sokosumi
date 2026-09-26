import type {
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageSession,
  ProjectImageSettings,
  ProjectImageStudioCatalog,
  ProjectImageStudioState,
} from "@/lib/clients/generated/core/types.gen";

export type StudioAsset = ProjectImageAsset;
export type StudioJob = ProjectImageJob;
export type StudioSession = ProjectImageSession;
export type StudioState = ProjectImageStudioState;
export type StudioSettings = ProjectImageSettings;
export type StudioCatalog = ProjectImageStudioCatalog;
export type StudioModel = StudioCatalog["models"][number];
export type StudioPlacement = StudioCatalog["placements"][number];

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

/**
 * What the person is currently aiming at.
 *
 * Shared by the composer and the chat rather than owned by either. The chips
 * are a statement about the work, so the assistant has to know about them too
 * — "make it warmer" after choosing Instagram Reels means a 9:16 Reels concept,
 * and an assistant that cannot see the chips would answer with a square.
 */
export interface StudioTarget {
  modelIds: string[];
  placementId: string | null;
  settings: StudioSettings;
}

/** What the gallery is narrowed to. Mirrors the review decisions plus "all". */
export type StudioFilter = "all" | "approved" | "rejected" | "undecided";

/**
 * Every visible string, resolved on the server.
 *
 * Two kinds of string are deliberately absent. Model and placement names come
 * from Core's catalog and are rendered as they arrive, because they are
 * product names ("FLUX.2 Pro", "Instagram Reels") rather than prose. And any
 * string that interpolates a number the server cannot know — "3 selected",
 * "Generate 4 images" — is resolved in the client with `useTranslations`,
 * because next-intl parses `{count}` as an ICU argument and returns the
 * message key when it is called without one. Reaching for `String.replace`
 * on a resolved message instead is what put a raw translation key on screen.
 */
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
  loadOlder: string;
  errorSessionExpired: string;
  errorRefreshFailed: string;
  errorLoadOlderFailed: string;
  retryConnection: string;

  // Composer and the model/placement catalog.
  composerTitle: string;
  model: string;
  modelsUsed: string;
  placement: string;
  placementNone: string;
  placementTarget: string;
  placementNotOutput: string;
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  copies: string;
  generateOne: string;
  modelUnsupportedForPlacement: string;
  catalogVerified: string;
  modelNotInCatalog: string;

  // The in-page batch queue.
  waitingForSlot: string;
  waitingForSlotBody: string;
  queueNotDurable: string;
  removeFromQueue: string;

  // Gallery, selection and comparison.
  gallery: string;
  filterRejected: string;
  filterUndecided: string;
  noneMatchFilter: string;
  select: string;
  deselect: string;
  compareSelected: string;
  clearSelection: string;
  openDetails: string;
  close: string;
  details: string;
  dimensions: string;
  created: string;
  seed: string;
  noSeed: string;
  parentVersion: string;
  compareHint: string;
  compareNeedsTwo: string;
  bytesUnavailable: string;

  // Chat pane.
  chatCollapse: string;
  chatExpand: string;
  jumpToLatest: string;
  contextAttached: string;
}
