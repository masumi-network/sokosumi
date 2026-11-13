"use server";

import {
  type AvailableAdAccount,
  answerCmoBrandBrainQuestionForProject,
  answerCmoMarketingStrategyQuestionForProject,
  applyCmoPlanAnswersForProject,
  approveCmoMarketingStrategyForProject,
  type CmoAdCampaigns,
  type CmoAdsFinalized,
  type CmoCusoList,
  type CmoMeasurement,
  type CmoOverview,
  type CmoSubscriptionPlan,
  changeCmoPlanForProject,
  chooseCmoAdAccountForProject,
  completeSokoBotIntegrationAuth,
  confirmCmoBrandBrainForProject,
  connectCmoAdsForProject,
  connectCmoMeasurementForProject,
  finalizeCmoAdsForProject,
  finalizeCmoMeasurementForProject,
  finalizeCmoSocialConnectionForProject,
  getChatsRoomsByIdMessages,
  getCmoCalendarEntryTextForProject,
  getCmoOverviewForProject,
  getContactLists,
  initiateCmoSocialConnectionForProject,
  launchCmoSearchAdForProject,
  listCmoAdCampaignsForProject,
  listCmoAdChoicesForProject,
  listCmoCusos,
  listCmoPlans,
  openCmoCustomerPortalForProject,
  pauseCmoCalendarEntryForProject,
  postChatsRoomsByIdMessages,
  postComposioCallbackComplete,
  postContactLists,
  postContactListsByIdImport,
  requestCmoStrategyForProject,
  retryCmoOnboardingForProject,
  revertCmoUpdateForProject,
  setCmoAdBudgetForProject,
  setCmoAdCampaignStatusForProject,
  startCmoOnboarding,
  startCmoOverForProject,
  startCmoPlanCheckoutForProject,
  startCmoTopUpForProject,
  updateCmoBrandBrainForProject,
} from "@sokosumi/core-client";
import {
  CORE_API_ERROR_KINDS,
  type CoreApiErrorKind,
  normalizeWebsiteUrl,
} from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AGENT_NAME } from "../lib/agent";
import { type CusoMessage, toCusoMessages } from "../lib/chat-messages";
import { coreForCurrentUser } from "../lib/core";
import { INVITE_ONLY_NOTE, INVITE_ONLY_TITLE } from "../lib/invite-only";
import { lastCusoCookie } from "../lib/last-cuso";
import {
  readSkippedSteps,
  SKIPPED_STEPS_MAX_AGE,
  type SkippedStep,
  skippedStepsCookie,
  withSkippedSteps,
} from "../lib/skipped-steps";
import { VIEW_PATHS } from "../lib/views";

async function requireCore() {
  const core = await coreForCurrentUser();
  if (!core) throw new Error("Not signed in to Sokosumi");
  return core;
}

/** What this person skipped in hiring, to route its steps. */
export async function skippedSteps(projectId: string): Promise<SkippedStep[]> {
  const cookie = (await cookies()).get(skippedStepsCookie(projectId));
  return readSkippedSteps(cookie?.value);
}

/**
 * Core's overview with the steps this person skipped. Every overview CMO
 * shows goes through here: the poll once showed Accounts again after the
 * person had moved on.
 */
async function withSkipped(overview: CmoOverview): Promise<CmoOverview> {
  return withSkippedSteps(overview, await skippedSteps(overview.projectId));
}

/**
 * The Cuso of this Project, or null when it has none or the person may no
 * longer use it. Every action after it names his Project.
 */
export async function loadOverview(
  projectId: string,
): Promise<CmoOverview | null> {
  return overviewOf(await requireCore(), projectId);
}

/**
 * The Cuso of the Project the page rendered, or null when that Project has
 * none (or the person may no longer see it).
 */
async function overviewOf(
  core: Awaited<ReturnType<typeof requireCore>>,
  projectId: string,
): Promise<CmoOverview | null> {
  const { data, response } = await getCmoOverviewForProject({
    ...core,
    path: { projectId },
  });
  if (response?.status === 404) return null;
  if (!data) throw new Error("Could not load CMO");
  return withSkipped(data.data);
}

/**
 * Every Cuso the person can work with, newest first, for the Cuso picker,
 * and whether Core's hire allowlist lets them hire another.
 */
export async function loadCusos(): Promise<CmoCusoList> {
  const { data } = await listCmoCusos(await requireCore());
  if (!data) throw new Error("Could not list the Cusos");
  return data.data;
}

/** Remembers a skipped hiring step in CMO's cookie for this Cuso. */
async function skipStep(
  projectId: string,
  step: SkippedStep,
): Promise<CmoOverview> {
  const overview = await requireOverview(projectId);
  const skipped = [
    ...new Set([...(await skippedSteps(overview.projectId)), step]),
  ];
  (await cookies()).set(
    skippedStepsCookie(overview.projectId),
    skipped.join(","),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SKIPPED_STEPS_MAX_AGE,
    },
  );
  return withSkippedSteps(overview, skipped);
}

async function requireOverview(projectId: string): Promise<CmoOverview> {
  const overview = await loadOverview(projectId);
  if (!overview) throw new Error(`${AGENT_NAME} is not hired yet`);
  return overview;
}

/** What the start form shows after a submit that did not finish. */
export interface OnboardFormState {
  /** Counts submits, so the form remounts with the values below. */
  attempt: number;
  websiteUrl: string;
  /** Where Cuso goes: an organization's id, or "" for a new organization. */
  organizationId?: string;
  errors: { websiteUrl?: string; form?: string };
  /** Refused for an unpaid Cuso: where to continue with him instead. */
  unpaidCuso?: { href: string; businessName: string };
}

/** What the start form says for each refusal Core declares, by its kind. */
const HIRE_REFUSALS: Partial<Record<CoreApiErrorKind, string>> = {
  [CORE_API_ERROR_KINDS.CMO_HIRE_NOT_ALLOWED]: `${INVITE_ONLY_TITLE} ${INVITE_ONLY_NOTE}`,
  [CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED]: `You need a Seat in that organization to hire ${AGENT_NAME}. Ask its owner for one, or choose another organization.`,
  [CORE_API_ERROR_KINDS.ORGANIZATION_LIMIT_REACHED]:
    "You've reached the organization limit. Choose one of your organizations instead.",
  [CORE_API_ERROR_KINDS.ORGANIZATION_MEMBERSHIP_REQUIRED]:
    "You're no longer a member of that organization. Choose another one.",
};

/**
 * Hiring Cuso's start form: the website and where he goes, a new
 * organization named after it ("") or one the person belongs to. Opens the
 * hired Cuso and remembers him on this device.
 */
export async function onboard(
  previous: OnboardFormState,
  formData: FormData,
): Promise<OnboardFormState> {
  const typed = String(formData.get("websiteUrl") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "");
  const result = {
    attempt: previous.attempt + 1,
    websiteUrl: typed,
    organizationId,
  };

  const websiteUrl = normalizeWebsiteUrl(typed);
  if (!websiteUrl) {
    return {
      ...result,
      errors: { websiteUrl: "Enter a website, like acme.com." },
    };
  }

  const core = await requireCore();
  const { data, error } = await startCmoOnboarding({
    ...core,
    body: organizationId ? { websiteUrl, organizationId } : { websiteUrl },
  });
  if (!data) {
    const kind =
      error && typeof error === "object" && "kind" in error
        ? String(error.kind)
        : undefined;
    const unpaid =
      kind === CORE_API_ERROR_KINDS.CMO_UNPAID_CUSO &&
      error &&
      "unpaidCuso" in error
        ? error.unpaidCuso
        : undefined;
    if (unpaid) {
      return {
        ...result,
        errors: {
          form: `Your ${AGENT_NAME} for ${unpaid.businessName} is not subscribed yet. Subscribe there, or start him over, before you hire another.`,
        },
        unpaidCuso: {
          href: `/?project=${encodeURIComponent(unpaid.projectId)}`,
          businessName: unpaid.businessName,
        },
      };
    }
    const refusal = kind ? HIRE_REFUSALS[kind as CoreApiErrorKind] : undefined;
    return {
      ...result,
      errors: { form: refusal ?? "That did not work. Try again." },
    };
  }
  const { projectId } = data.data;
  (await cookies()).set(...lastCusoCookie(projectId));
  revalidatePath("/");
  redirect(`/?project=${encodeURIComponent(projectId)}`);
}

/**
 * Approves the newest strategy version, or the one named (going back to it),
 * on the Project's Marketing strategy.
 */
export async function approveStrategy(
  projectId: string,
  versionId?: string,
): Promise<CmoOverview> {
  const strategyId =
    versionId ?? (await requireOverview(projectId)).strategyVersion?.id;
  if (!strategyId) throw new Error("There is no strategy to approve yet");
  const { error } = await approveCmoMarketingStrategyForProject({
    ...(await requireCore()),
    path: { projectId, strategyId },
  });
  if (error)
    throw new Error(errorText(error, "Could not approve the strategy"));
  return requireOverview(projectId);
}

/** A member confirmed the Project's Brand Brain; Cuso's questions come next. */
export async function approveBrandBrain(
  projectId: string,
): Promise<CmoOverview> {
  const { error } = await confirmCmoBrandBrainForProject({
    ...(await requireCore()),
    path: { projectId },
  });
  if (error) {
    throw new Error(errorText(error, "Could not approve the Brand Brain"));
  }
  return requireOverview(projectId);
}

/** One answer to one of Cuso's questions: yes, no (with what is true) or not sure. */
export async function answerBrandQuestion(
  projectId: string,
  answer: {
    questionId: string;
    answer: "yes" | "no" | "unsure";
    note?: string;
  },
): Promise<CmoOverview> {
  const { error } = await answerCmoBrandBrainQuestionForProject({
    ...(await requireCore()),
    path: { projectId },
    body: answer,
  });
  if (error) throw new Error(errorText(error, "Could not save the answer"));
  return requireOverview(projectId);
}

/** One answer to one of the newest plan's yes/no questions. */
export async function answerPlanQuestion(
  projectId: string,
  answer: {
    questionId: string;
    answer: "yes" | "no" | "unsure";
    note?: string;
  },
): Promise<CmoOverview> {
  const strategyId = (await requireOverview(projectId)).strategyVersion?.id;
  if (!strategyId) throw new Error("There is no strategy yet");
  const { error } = await answerCmoMarketingStrategyQuestionForProject({
    ...(await requireCore()),
    path: { projectId, strategyId },
    body: answer,
  });
  if (error) throw new Error(errorText(error, "Could not save the answer"));
  return requireOverview(projectId);
}

/** Cuso fits the plan to the owner's answers. */
export async function applyPlanAnswers(projectId: string): Promise<{
  overview: CmoOverview | null;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await applyCmoPlanAnswersForProject({
    ...core,
    path: { projectId },
  });
  return {
    overview: await loadOverview(projectId),
    error: error ? errorText(error, "Could not update the plan") : null,
  };
}

/** The owner's own edit to the Brand Brain, saved as written. */
export async function saveBrandBrain(
  projectId: string,
  brandBrain: NonNullable<CmoOverview["brandBrain"]>,
): Promise<CmoOverview> {
  const { error } = await updateCmoBrandBrainForProject({
    ...(await requireCore()),
    path: { projectId },
    body: { brandBrain },
  });
  if (error)
    throw new Error(errorText(error, "Could not save the Brand Brain"));
  return requireOverview(projectId);
}

export async function pauseEntry(
  projectId: string,
  id: string,
): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await pauseCmoCalendarEntryForProject({
    ...core,
    path: { projectId, id },
  });
  if (!data) throw new Error("Could not pause this entry");
  return withSkipped(data.data);
}

/** Starts learning again; a refusal (such as no credits) comes back as text. */
export async function retryLearning(projectId: string): Promise<{
  overview: CmoOverview;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await retryCmoOnboardingForProject({
    ...core,
    path: { projectId },
  });
  const overview = await loadOverview(projectId);
  if (!overview) throw new Error("Could not load CMO");
  return {
    overview,
    error: error ? errorText(error, "Could not start") : null,
  };
}

export async function revertUpdate(
  projectId: string,
  id: string,
): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await revertCmoUpdateForProject({
    ...core,
    path: { projectId, id },
  });
  if (!data) throw new Error("Could not revert the changes");
  return withSkipped(data.data);
}

type Core = Awaited<ReturnType<typeof requireCore>>;

function chatHeaders(core: Core, overview: CmoOverview) {
  return overview.organizationSlug
    ? { ...core.headers, "X-Organization-Slug": overview.organizationSlug }
    : core.headers;
}

async function messagesFor(
  core: Core,
  overview: CmoOverview,
): Promise<CusoMessage[]> {
  const { data } = await getChatsRoomsByIdMessages({
    client: core.client,
    headers: chatHeaders(core, overview),
    path: { id: overview.roomId },
    query: { limit: 50 },
  });
  return toCusoMessages(data?.data ?? []);
}

/** The latest messages with Cuso, oldest first. */
export async function loadMessages(projectId: string): Promise<CusoMessage[]> {
  const core = await requireCore();
  const overview = await overviewOf(core, projectId);
  if (!overview) return [];
  return messagesFor(core, overview);
}

/** The words of a piece Cuso wrote into the owner's Files. */
export async function loadPieceText(
  projectId: string,
  entryId: string,
): Promise<string | null> {
  const core = await requireCore();
  const { data } = await getCmoCalendarEntryTextForProject({
    ...core,
    path: { projectId, id: entryId },
  });
  return data?.data.text ?? null;
}

/** Overview and messages in one go, for the app's polling. */
export async function loadState(projectId: string): Promise<{
  overview: CmoOverview | null;
  messages: CusoMessage[];
}> {
  const core = await requireCore();
  // Any failure but a 404 throws, so it is not "not hired": showing the hire
  // flow would offer a second business.
  const overview = await loadOverview(projectId);
  if (!overview) return { overview: null, messages: [] };
  return { overview, messages: await messagesFor(core, overview) };
}

export async function sendMessage(
  projectId: string,
  content: string,
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const core = await requireCore();
  const overview = await overviewOf(core, projectId);
  if (!overview) throw new Error(`${AGENT_NAME} is not hired yet`);
  const { error } = await postChatsRoomsByIdMessages({
    client: core.client,
    headers: chatHeaders(core, overview),
    path: { id: overview.roomId },
    body: { content: text, mentionedSokoBotIds: [overview.sokoBotId] },
  });
  if (error) throw new Error("Could not send the message");
}

function errorText(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : fallback;
}

/**
 * Asks Cuso for the strategy, or for a change to it. Returns the overview
 * with his new work running, or why it could not start.
 */
export async function requestStrategy(
  projectId: string,
  note?: string,
): Promise<{
  overview: CmoOverview | null;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await requestCmoStrategyForProject({
    ...core,
    path: { projectId },
    body: note?.trim() ? { note: note.trim() } : {},
  });
  return {
    overview: await loadOverview(projectId),
    error: error ? errorText(error, "Could not start planning") : null,
  };
}

/** The owner's own monthly ad budget; Cuso re-plans the ads around it. */
export async function setAdBudget(
  projectId: string,
  monthly: number,
  currency: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { error } = await setCmoAdBudgetForProject({
    ...core,
    path: { projectId },
    body: { monthly, currency },
  });
  return {
    overview: await overviewOf(core, projectId),
    error: error ? errorText(error, "Could not set the budget") : null,
  };
}

/**
 * The founder moved on from the Accounts step: the checkout comes next
 * (ADR 0068), or the chat for a Cuso hired with Starter credits. A
 * connection already counts; skipping is kept in CMO's cookie. It goes to
 * the app's home, not back to the address it came from: back from a
 * connection, that address keeps the Accounts step open.
 */
export async function finishAccounts(projectId: string): Promise<never> {
  await skipStep(projectId, "accounts");
  revalidatePath("/");
  redirect(`/?project=${encodeURIComponent(projectId)}`);
}

/**
 * The founder chose to leave Cuso's questions about the brand for later; they
 * stay reachable from the Brand step. Kept in CMO's cookie like the accounts.
 */
export async function skipBrandQuestions(
  projectId: string,
): Promise<CmoOverview> {
  return skipStep(projectId, "questions");
}

/**
 * Archives the Cuso on screen and opens the hire form, with a new
 * organization selected, even when other Cusos remain (ADR 0065). A refusal
 * (not an owner or admin) comes back as text.
 */
export async function startOver(projectId: string): Promise<string | null> {
  const core = await requireCore();
  const { error } = await startCmoOverForProject({
    ...core,
    path: { projectId },
  });
  if (error) {
    return error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : "Could not start over";
  }
  revalidatePath("/");
  // A person who may not hire goes to the Cusos left, or the invite-only page.
  const list = await loadCusos().catch(() => undefined);
  redirect(list?.mayHire === false ? "/?cusos=1" : "/?hire=1");
}

/** The CMO plans, for the checkout step; none when Core cannot read them from Polar. */
export async function loadPlans(): Promise<CmoSubscriptionPlan[]> {
  const { data } = await listCmoPlans(await requireCore());
  return data?.data ?? [];
}

/** The contact list Cuso writes the newsletter for; Core counts it by this name. */
const NEWSLETTER_LIST = "Newsletter";

/** The workspace's Newsletter list, created the first time. */
async function newsletterListId(
  options: Awaited<ReturnType<typeof inCusoWorkspace>>,
): Promise<string | null> {
  const { data } = await getContactLists(options);
  const existing = data?.data.find(
    (list) =>
      list.kind === "manual" &&
      list.name.toLowerCase() === NEWSLETTER_LIST.toLowerCase(),
  );
  if (existing) return existing.id;
  const { data: created } = await postContactLists({
    ...options,
    body: { name: NEWSLETTER_LIST, color: "blue" },
  });
  return created?.data.id ?? null;
}

/** Adds the founder's mailing list for the newsletter Cuso writes. */
export async function addMailingList(
  projectId: string,
  text: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const overview = await loadOverview(projectId);
  if (!overview) {
    return { overview: null, error: `${AGENT_NAME} is not hired yet` };
  }
  const options = await inCusoWorkspace(overview);
  const listId = await newsletterListId(options);
  if (!listId) return { overview: null, error: "Could not add the list" };
  const { error } = await postContactListsByIdImport({
    ...options,
    path: { id: listId },
    body: { text },
  });
  if (error) {
    return {
      overview: null,
      error: errorText(error, "Could not add the list"),
    };
  }
  return { overview: await loadOverview(projectId), error: null };
}

/**
 * Where the provider sends the founder back after connecting. The address
 * names the Project it started from, so the connection finishes on that Cuso.
 */
async function callbackUrl(
  path: string,
  params: Record<string, string> & { project: string },
): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}?${new URLSearchParams(params)}`;
}

/**
 * Request options in Cuso's workspace for the standard routes, which find an
 * organization's Project and contacts only with its slug header.
 */
async function inCusoWorkspace(
  overview: Pick<CmoOverview, "organizationSlug">,
) {
  const core = await requireCore();
  return {
    ...core,
    headers: {
      ...core.headers,
      ...(overview.organizationSlug
        ? { "x-organization-slug": overview.organizationSlug }
        : {}),
    },
  };
}

/** Starts connecting a network; the browser goes to the returned URL. */
type SocialProvider = "x" | "linkedin" | "instagram" | "facebook" | "youtube";

/** Connects a network from the app's Channels page. */
export async function connectChannel(
  projectId: string,
  provider: SocialProvider,
): Promise<{ url: string | null; error: string | null }> {
  return startChannel(projectId, provider, "app");
}

/** Connects a network on the Accounts step; the founder comes back to it. */
export async function connectSetupChannel(
  projectId: string,
  provider: SocialProvider,
): Promise<{ url: string | null; error: string | null }> {
  return startChannel(projectId, provider, "onboarding");
}

async function startChannel(
  projectId: string,
  provider: SocialProvider,
  from: "onboarding" | "app",
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await initiateCmoSocialConnectionForProject({
    ...(await requireCore()),
    path: { projectId },
    body: {
      action: "connect",
      provider,
      callbackUrl: await callbackUrl("/connect/callback", {
        from,
        project: projectId,
      }),
    },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/**
 * Redeems the provider's one-use callback session, which Core needs before
 * it keeps a connection. Without a session there is nothing to redeem.
 */
async function redeemCallback(
  projectId: string,
  connectionId: string,
  sessionUri: string | null,
): Promise<void> {
  if (!sessionUri) return;
  const overview = await requireOverview(projectId);
  await postComposioCallbackComplete({
    ...(await inCusoWorkspace(overview)),
    body: { connectionId, sessionUri },
  });
}

/** Finishes a connection after the provider sent the founder back. */
export async function finalizeChannel(
  projectId: string,
  connectionId: string,
  sessionUri: string | null = null,
): Promise<boolean> {
  await redeemCallback(projectId, connectionId, sessionUri);
  const { error } = await finalizeCmoSocialConnectionForProject({
    ...(await requireCore()),
    path: { projectId },
    body: { connectionId },
  });
  return !error;
}

/** Starts connecting Google Ads or Meta Ads; the browser goes to the returned URL. */
export async function connectAds(
  projectId: string,
  provider: "google_ads" | "meta_ads",
  from: "onboarding" | "app",
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await connectCmoAdsForProject({
    ...core,
    path: { projectId, provider },
    body: {
      returnUrl: await callbackUrl("/ads/callback", {
        from,
        project: projectId,
      }),
    },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/** Finishes an ad connection after the founder signed in. */
export async function finalizeAds(
  projectId: string,
  connectionId: string,
  sessionUri: string | null,
): Promise<CmoAdsFinalized | null> {
  const core = await requireCore();
  const { data } = await finalizeCmoAdsForProject({
    ...core,
    path: { projectId },
    body: { connectionId, sessionUri },
  });
  return data?.data ?? null;
}

/** The ad accounts a connection reaches, for the founder to pick one. */
export async function loadAdChoices(
  projectId: string,
  adConnectionId: string,
): Promise<AvailableAdAccount[]> {
  const core = await requireCore();
  const { data } = await listCmoAdChoicesForProject({
    ...core,
    path: { projectId, adConnectionId },
  });
  return data?.data.accounts ?? [];
}

/** Attaches the ad account the founder picked. */
export async function chooseAdAccount(
  projectId: string,
  adConnectionId: string,
  externalAccountId: string,
): Promise<boolean> {
  const core = await requireCore();
  const { error } = await chooseCmoAdAccountForProject({
    ...core,
    path: { projectId },
    body: { adConnectionId, externalAccountId },
  });
  return !error;
}

/** Every ad account with its campaigns and numbers. */
export async function loadAdCampaigns(
  projectId: string,
  range: "LAST_7_DAYS" | "LAST_30_DAYS",
): Promise<CmoAdCampaigns["accounts"]> {
  const core = await requireCore();
  const { data } = await listCmoAdCampaignsForProject({
    ...core,
    path: { projectId },
    query: { range },
  });
  return data?.data.accounts ?? [];
}

/** Launches a search ad Cuso wrote; a refusal comes back as text. */
export async function launchAd(
  projectId: string,
  entryId: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await launchCmoSearchAdForProject({
    ...core,
    path: { projectId },
    body: { entryId },
  });
  if (!data) {
    return { overview: null, error: errorText(error, "Could not launch it") };
  }
  revalidatePath("/");
  return { overview: await withSkipped(data.data), error: null };
}

/** Pauses or starts a campaign; a refusal comes back as text. */
export async function setAdCampaignStatus(
  projectId: string,
  input: {
    accountId: string;
    campaignId: string;
    status: "ACTIVE" | "PAUSED";
  },
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await setCmoAdCampaignStatusForProject({
    ...core,
    path: { projectId },
    body: input,
  });
  if (!data) {
    return { overview: null, error: errorText(error, "Could not change it") };
  }
  revalidatePath("/");
  return { overview: await withSkipped(data.data), error: null };
}

/** Starts connecting a measurement source to Cuso; the browser goes to the returned URL. */
export async function connectMeasurement(
  projectId: string,
  provider: CmoMeasurement["provider"],
  from: "onboarding" | "app",
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await connectCmoMeasurementForProject({
    ...core,
    path: { projectId, provider },
    body: {
      returnUrl: await callbackUrl("/measure/callback", {
        provider,
        from,
        project: projectId,
      }),
    },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/**
 * Starts Polar's hosted checkout for this Cuso's CMO plan; the browser goes
 * to the returned URL. Polar sends the person back to the home page, which
 * shows the confirming state (`step=subscribed`) until the payment is in.
 */
export async function startPlanCheckout(
  projectId: string,
  interval: CmoSubscriptionPlan["interval"],
  /** The plan Polar opens on; without one, the cheapest. */
  tier?: string,
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await startCmoPlanCheckoutForProject({
    ...core,
    path: { projectId },
    body: {
      interval,
      tier,
      returnUrl: await callbackUrl("/", {
        project: projectId,
        step: "subscribed",
      }),
    },
  });
  if (!data) {
    return {
      url: null,
      error: errorText(error, "Could not open the checkout"),
    };
  }
  return { url: data.data.url, error: null };
}

/**
 * Starts Polar's checkout for a Project top-up of this Cuso; the browser goes
 * to the returned URL and comes back to this Cuso.
 */
export async function startTopUp(
  projectId: string,
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await startCmoTopUpForProject({
    ...core,
    path: { projectId },
    body: { returnUrl: await callbackUrl("/", { project: projectId }) },
  });
  if (!data) {
    return {
      url: null,
      error: errorText(error, "Could not open the checkout"),
    };
  }
  return { url: data.data.url, error: null };
}

/**
 * Moves this Cuso to another tier of his interval (owners and admins). An
 * upgrade applies at once; a downgrade at the next renewal. His current tier
 * while a downgrade is pending keeps the plan.
 */
export async function changePlan(
  projectId: string,
  tier: string,
): Promise<{
  change: "upgrade" | "downgrade" | "kept" | null;
  error: string | null;
}> {
  const core = await requireCore();
  const { data, error } = await changeCmoPlanForProject({
    ...core,
    path: { projectId },
    body: { tier },
  });
  if (!data) {
    return {
      change: null,
      error: errorText(error, "Could not change the plan"),
    };
  }
  return { change: data.data.change, error: null };
}

/**
 * Opens Polar's customer portal for this Cuso's organization (owners and
 * admins); it links back to Settings.
 */
export async function openPortal(
  projectId: string,
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await openCmoCustomerPortalForProject({
    ...core,
    path: { projectId },
    body: {
      returnUrl: await callbackUrl(VIEW_PATHS.settings, { project: projectId }),
    },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not open billing") };
  }
  return { url: data.data.url, error: null };
}

/** Finishes a measurement connection after the founder signed in. */
export async function finalizeMeasurement(
  projectId: string,
  provider: CmoMeasurement["provider"],
  sessionUri: string | null,
): Promise<boolean> {
  // Back from Composio's verifier: redeeming the session for Cuso's bot also
  // keeps the connection.
  if (sessionUri) {
    const overview = await requireOverview(projectId);
    const { error } = await completeSokoBotIntegrationAuth({
      ...(await inCusoWorkspace(overview)),
      path: { sokoBotId: overview.sokoBotId },
      body: { sessionUri },
    });
    return !error;
  }
  const core = await requireCore();
  const { error } = await finalizeCmoMeasurementForProject({
    ...core,
    path: { projectId, provider },
  });
  return !error;
}
