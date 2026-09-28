import { STUDIO_TEMPLATE_IDS, type StudioTemplateId } from "./studio-templates";
import type { StudioFailureReason, StudioLabels } from "./types";

/** Every string the studio needs, resolved once by whichever page mounts it. */
type Translator = (key: string) => string;

/**
 * The studio's strings, from `App.Studio`.
 *
 * Spelled out rather than derived from the message catalogue: next-intl's keys
 * are literals, so a loop over `Object.keys` would both lose the type and hide
 * from the parity check which keys this surface actually reads.
 */
export function buildStudioLabels(t: Translator): StudioLabels {
  return {
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    promptPlaceholder: t("promptPlaceholder"),
    generate: t("generate"),
    refine: t("refine"),
    regenerate: t("regenerate"),
    reroll: t("reroll"),
    reusePrompt: t("reusePrompt"),
    download: t("download"),
    compare: t("compare"),
    approve: t("approve"),
    reject: t("reject"),
    undecided: t("undecided"),
    approved: t("approved"),
    rejected: t("rejected"),
    clearReview: t("clearReview"),
    feedbackPlaceholder: t("feedbackPlaceholder"),
    version: t("version"),
    generating: t("generating"),
    queued: t("queued"),
    failed: t("failed"),
    uncertainTitle: t("uncertainTitle"),
    uncertainBody: t("uncertainBody"),
    checkAgain: t("checkAgain"),
    submitAnyway: t("submitAnyway"),
    tryAgain: t("tryAgain"),
    cancel: t("cancel"),
    cancelRequested: t("cancelRequested"),
    clearFilter: t("clearFilter"),
    filterAll: t("filterAll"),
    filterApproved: t("filterApproved"),
    lineage: t("lineage"),
    from: t("from"),
    loadOlder: t("loadOlder"),
    errorSessionExpired: t("errorSessionExpired"),
    errorRefreshFailed: t("errorRefreshFailed"),
    errorLoadOlderFailed: t("errorLoadOlderFailed"),
    errorUnreachable: t("errorUnreachable"),
    errorInsufficientCredits: t("errorInsufficientCredits"),
    composerTitle: t("composerTitle"),
    model: t("model"),
    aspectRatio: t("aspectRatio"),
    resolution: t("resolution"),
    outputFormat: t("outputFormat"),
    copies: t("copies"),
    selectAllModels: t("selectAllModels"),
    noModelSelected: t("noModelSelected"),
    moreOptions: t("moreOptions"),
    generateOne: t("generateOne"),
    modelNotInCatalog: t("modelNotInCatalog"),
    waitingForSlot: t("waitingForSlot"),
    waitingForSlotBody: t("waitingForSlotBody"),
    queueNotDurable: t("queueNotDurable"),
    templates: t("templates"),
    templateLabels: templateLabels(t),
    gallery: t("gallery"),
    filterRejected: t("filterRejected"),
    filterUndecided: t("filterUndecided"),
    noneMatchFilter: t("noneMatchFilter"),
    select: t("select"),
    deselect: t("deselect"),
    compareSelected: t("compareSelected"),
    clearSelection: t("clearSelection"),
    openDetails: t("openDetails"),
    close: t("close"),
    dimensions: t("dimensions"),
    created: t("created"),
    seed: t("seed"),
    noSeed: t("noSeed"),
    parentVersion: t("parentVersion"),
    compareHint: t("compareHint"),
    compareNeedsTwo: t("compareNeedsTwo"),
    bytesUnavailable: t("bytesUnavailable"),
    imageUnreadable: t("imageUnreadable"),
    imageRetry: t("imageRetry"),
    previousVersion: t("previousVersion"),
    nextVersion: t("nextVersion"),
    generationTime: t("generationTime"),
    credits: t("credits"),
    creditsTitle: t("creditsTitle"),
    creditsCharged: t("creditsCharged"),
    creditsUnderivable: t("creditsUnderivable"),
    creditsNoFigure: t("creditsNoFigure"),
    failedNoCharge: t("failedNoCharge"),
    failedBody: failureBodies(t),
    failedBodyUnreported: t("failedBodyUnreported"),
    failedDetails: t("failedDetails"),
  };
}

/**
 * The template labels, derived rather than spelled out.
 *
 * The exception the rule above allows: the source of truth is
 * `STUDIO_TEMPLATE_IDS`, a typed local tuple, so the result is still a
 * `Record<StudioTemplateId, string>` and the key paths are still discoverable
 * from one list. Looping over the *catalogue* would lose both.
 */
function templateLabels(t: Translator): Record<StudioTemplateId, string> {
  return Object.fromEntries(
    STUDIO_TEMPLATE_IDS.map((id) => [id, t(`Templates.${id}`)]),
  ) as Record<StudioTemplateId, string>;
}

/**
 * Every failure reason Core can report, in the reader's language.
 *
 * Spelled out rather than looped, and that is the point: the record is typed by
 * Core's own union, so a code Core adds fails to compile here until somebody
 * writes the sentence for it. A loop over a local list would compile happily and
 * ship an English fallback instead.
 */
function failureBodies(t: Translator): Record<StudioFailureReason, string> {
  return {
    provider_rejected: t("FailureReasons.provider_rejected"),
    provider_error: t("FailureReasons.provider_error"),
    provider_lost_request: t("FailureReasons.provider_lost_request"),
    provider_unreachable: t("FailureReasons.provider_unreachable"),
    submission_uncertain: t("FailureReasons.submission_uncertain"),
    reference_not_sendable: t("FailureReasons.reference_not_sendable"),
    request_not_supported: t("FailureReasons.request_not_supported"),
    cancelled: t("FailureReasons.cancelled"),
    abandoned_before_send: t("FailureReasons.abandoned_before_send"),
    access_revoked: t("FailureReasons.access_revoked"),
    storage_unavailable: t("FailureReasons.storage_unavailable"),
    unknown: t("FailureReasons.unknown"),
  };
}
