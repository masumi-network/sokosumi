import type {
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageSettings,
  ProjectImageStudioCatalog,
  ProjectImageStudioState,
} from "@/lib/clients/generated/core/types.gen";
import type { StudioTemplateId } from "./studio-templates";

export type StudioAsset = ProjectImageAsset;
export type StudioJob = ProjectImageJob;
export type StudioState = ProjectImageStudioState;
export type StudioSettings = ProjectImageSettings;
export type StudioCatalog = ProjectImageStudioCatalog;
export type StudioModel = StudioCatalog["models"][number];

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

/**
 * A timestamp on a studio row, as epoch milliseconds.
 *
 * The generated types say `Date`, and on these rows that is not true. The
 * studio reads its state by two routes — the server component hands the first
 * copy down, and the poll goes through this app's own `/state` handler, which
 * is `NextResponse.json` and therefore stringifies every date. So the same
 * field is a `Date` on one path and an ISO string on the other, and calling
 * `.getTime()` on it took the whole studio into the error boundary on the
 * deployment. The rest of this folder already casts these to `string` for the
 * same reason; this accepts either and says so.
 */
function epochMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How long the provider spent on a job, in milliseconds.
 *
 * `submittedAt` to `settledAt` is the provider's own time, which is the number
 * worth putting beside a result. `createdAt` is when Sokosumi accepted the
 * request: on a batch that waited for a slot it can be minutes earlier, and
 * that wait is this studio's doing rather than the model's, so it is only the
 * fallback for a job that somehow settled without a submission timestamp.
 *
 * `null` for anything still running, for an unreadable timestamp, and for a
 * negative interval — clock skew between the rows is not a generation that took
 * less than no time.
 */
export function generationElapsedMs(job: StudioJob): number | null {
  const settled = epochMs(job.settledAt);
  const started = epochMs(job.submittedAt) ?? epochMs(job.createdAt);
  if (settled === null || started === null) return null;
  const elapsed = settled - started;
  return elapsed >= 0 ? elapsed : null;
}

/**
 * Each finished version's generation time, keyed by the version it produced.
 *
 * Built from the jobs the state carries, which is the most recent page of them
 * — so a version older than that page has no entry and its tile simply says
 * nothing about time, rather than saying nothing happened.
 */
export function elapsedByAssetId(jobs: StudioJob[]): Record<string, number> {
  const byAsset: Record<string, number> = {};
  for (const job of jobs) {
    if (!job.assetId) continue;
    const elapsed = generationElapsedMs(job);
    if (elapsed !== null) byAsset[job.assetId] = elapsed;
  }
  return byAsset;
}

/**
 * What each finished version was actually debited, keyed by the version.
 *
 * Read off the job rows rather than derived from the catalog. This is the charge
 * the ledger took, not an estimate of one — and a refunded job reads as zero,
 * because a generation that failed cost the person nothing and the tile must not
 * claim otherwise. A version whose job has fallen off the most recent page has
 * no entry and its tile simply says nothing about credits.
 */
export function creditsByAssetId(jobs: StudioJob[]): Record<string, number> {
  const byAsset: Record<string, number> = {};
  for (const job of jobs) {
    if (!job.assetId || job.credits === null) continue;
    byAsset[job.assetId] = job.refunded ? 0 : job.credits;
  }
  return byAsset;
}

/**
 * A generation time, in the unit a person compares models in.
 *
 * One decimal under a hundred seconds, because the difference between 4.2s and
 * 4.8s is the kind of thing this number exists to show; whole seconds above
 * that, where a tenth is noise.
 */
export function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 100 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function assetContentUrl(projectId: string, assetId: string): string {
  return `/api/projects/${projectId}/image-studio/assets/${assetId}/content`;
}

/**
 * What the person is currently aiming at.
 *
 * Held by the studio rather than by the composer, because the lightbox reads it
 * too: "new variation" has to repeat a version on the terms that version was
 * made with, and the reference selection in the gallery is part of the same
 * statement about the work.
 */
export interface StudioTarget {
  modelIds: string[];
  settings: StudioSettings;
}

/** What the gallery is narrowed to. Mirrors the review decisions plus "all". */
export type StudioFilter = "all" | "approved" | "rejected" | "undecided";

/**
 * Every visible string, resolved on the server.
 *
 * Two kinds of string are deliberately absent. Model names come from Core's
 * catalog and are rendered as they arrive, because they are product names
 * ("FLUX.2 Pro") rather than prose. And any
 * string that interpolates a number the server cannot know — "3 selected",
 * "Generate 4 images" — is resolved in the client with `useTranslations`,
 * because next-intl parses `{count}` as an ICU argument and returns the
 * message key when it is called without one. Reaching for `String.replace`
 * on a resolved message instead is what put a raw translation key on screen.
 */
export interface StudioLabels {
  emptyTitle: string;
  emptyBody: string;
  promptPlaceholder: string;
  generate: string;
  refine: string;
  regenerate: string;
  download: string;
  compare: string;
  approve: string;
  reject: string;
  undecided: string;
  approved: string;
  rejected: string;
  clearReview: string;
  feedbackPlaceholder: string;
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
  clearFilter: string;
  filterAll: string;
  filterApproved: string;
  lineage: string;
  from: string;
  loadOlder: string;
  errorSessionExpired: string;
  errorRefreshFailed: string;
  errorLoadOlderFailed: string;
  errorUnreachable: string;
  errorInsufficientCredits: string;

  // Composer and the model catalog.
  composerTitle: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  copies: string;
  selectAllModels: string;
  noModelSelected: string;
  generateOne: string;
  moreOptions: string;
  modelNotInCatalog: string;

  // The in-page batch queue.
  waitingForSlot: string;
  waitingForSlotBody: string;
  queueNotDurable: string;

  // The template presses above the gallery. Their prompt bodies are not in
  // here: they are model input rather than copy, and they stay English in
  // every locale — see `studio-templates.ts`.
  templates: string;
  templateLabels: Record<StudioTemplateId, string>;

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
  dimensions: string;
  created: string;
  seed: string;
  noSeed: string;
  parentVersion: string;
  compareHint: string;
  compareNeedsTwo: string;
  bytesUnavailable: string;
  previousVersion: string;
  nextVersion: string;

  // What a batch costs and how long it took. Credits, not dollars, and not an
  // approximation: `creditsPerImageCents` is the function Core charges with, so
  // the figure shown before the press is the figure the ledger takes.
  generationTime: string;
  credits: string;
  creditsTitle: string;
  creditsCharged: string;
  creditsUnderivable: string;
  creditsNoFigure: string;
  /** Said on a failed generation, because a failure is refunded in full. */
  failedRefunded: string;
  /**
   * What a failed generation says instead of the provider's transport error.
   *
   * One sentence for every reason: Core sends no stable reason code yet, and
   * `job.error` is English free text from fal or the runner.
   */
  failedBody: string;
  /** Opens the provider's own words, for whoever has to chase them. */
  failedDetails: string;
}
