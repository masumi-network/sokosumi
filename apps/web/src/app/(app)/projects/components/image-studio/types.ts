import type {
  ProjectImageAsset,
  ProjectImageJob,
  ProjectImageSettings,
  ProjectImageStudioCatalog,
  ProjectImageStudioState,
} from "@sokosumi/core-client";
import type { StudioTemplateId } from "./studio-templates";

export type StudioAsset = ProjectImageAsset;
export type StudioJob = ProjectImageJob;
export type StudioState = ProjectImageStudioState;
export type StudioSettings = ProjectImageSettings;
export type StudioCatalog = ProjectImageStudioCatalog;
export type StudioModel = StudioCatalog["models"][number];

/**
 * Why a generation did not produce an image, as Core's stable code.
 *
 * Read off the generated type rather than restated, so a code Core adds is a
 * compile error here instead of a missing translation on someone's screen.
 * `null` is a row written before Core recorded reasons.
 */
export type StudioFailureReason = NonNullable<StudioJob["failureReason"]>;

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
export function epochMs(
  value: Date | string | null | undefined,
): number | null {
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
 * the ledger took, not an estimate of one: a catalog refresh must not restate
 * what somebody already paid. A version whose job has fallen off the most recent
 * page has no entry and its tile simply says nothing about credits.
 *
 * **Absent and zero are different claims, and both are reachable.** A job that
 * has fallen off the most recent page has no entry, and that means "we do not
 * know what this cost". A delivered image can legitimately carry `0`: Core
 * charges on success, and if the balance no longer covers the quote at delivery
 * it stores the image anyway and logs the shortfall rather than losing it — so
 * that image was free, which is a fact about it and not an absence of one.
 *
 * Hence `job.credits === null` to skip, never a falsy check, and `?? null` at
 * the read in `studio-gallery.tsx`. `0 || null` would turn a free image into an
 * unknown one, which is the one substitution this map exists to prevent.
 */
export function creditsByAssetId(jobs: StudioJob[]): Record<string, number> {
  const byAsset: Record<string, number> = {};
  for (const job of jobs) {
    if (!job.assetId || job.credits === null) continue;
    byAsset[job.assetId] = job.credits;
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
  reroll: string;
  reusePrompt: string;
  download: string;
  compare: string;
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
  unselectAllModels: string;
  searchModels: string;
  noModelsMatch: string;
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
  /** Only for a confirmed 404: this version's object really is gone. */
  bytesUnavailable: string;
  /**
   * For a load that failed without proving anything.
   *
   * An `img` error says nothing about why, and most of them are contention
   * rather than deletion — so this is what a reader gets unless the route
   * answers 404. See `StudioImage`.
   */
  imageUnreadable: string;
  imageRetry: string;
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
  /**
   * Said on a failed generation: it cost nothing.
   *
   * Because nothing was taken, not because something was given back — images
   * are charged on success, so a generation that produced none was never
   * charged. Unconditional for that reason: there is no per-job flag to read.
   */
  failedNoCharge: string;
  /**
   * What a failed generation says, per reason Core reports.
   *
   * Keyed by Core's own code, so the union and this record cannot drift: adding
   * a code to Core makes this a type error rather than a silent English
   * fallthrough. `unknown` is what an unrecognised stored code resolves to, and
   * `failedBodyUnreported` covers a row from before Core recorded reasons.
   */
  failedBody: Record<StudioFailureReason, string>;
  failedBodyUnreported: string;
  /** Opens the provider's own words, for whoever has to chase them. */
  failedDetails: string;
}
