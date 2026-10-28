"use server";

import {
  answerProjectBrandBrainQuestion,
  answerProjectMarketingStrategyQuestion,
  applyCmoPlanAnswers,
  approveProjectMarketingStrategy,
  type CmoMeasurement,
  type CmoOverview,
  chooseCmoMockPlan,
  completeCmoOnboarding,
  confirmProjectBrandBrain,
  connectCmoMeasurement,
  finalizeCmoMeasurement,
  getChatsRoomsByIdMessages,
  getCmoOverview,
  getContactLists,
  getSubscriptionCatalog,
  patchUsersByIdPreferences,
  pauseCmoCalendarEntry,
  postChatsRoomsByIdMessages,
  postContactLists,
  postContactListsByIdImport,
  postProjectsByIdSocialConnectionsFinalize,
  postProjectsByIdSocialConnectionsInitiate,
  requestCmoStrategy,
  retryCmoOnboarding,
  revertCmoUpdate,
  type SubscriptionCatalog,
  setCmoAdBudget,
  startCmoOnboarding,
  updateProjectBrandBrain,
} from "@sokosumi/core-client";
import { normalizeWebsiteUrl } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { readSokosumiAppBaseUrl } from "../lib/auth-config";
import { type CusoMessage, toCusoMessages } from "../lib/chat-messages";
import { coreForCurrentUser } from "../lib/core";

async function requireCore() {
  const core = await coreForCurrentUser();
  if (!core) throw new Error("Not signed in to Sokosumi");
  return core;
}

/** The Cuso the person works with, or null before they hire him. */
export async function loadOverview(): Promise<CmoOverview | null> {
  const core = await requireCore();
  const { data, response } = await getCmoOverview(core);
  if (response?.status === 404) return null;
  if (!data) throw new Error("Could not load CMO");
  return data.data;
}

async function requireOverview(): Promise<CmoOverview> {
  const overview = await loadOverview();
  if (!overview) throw new Error("Cuso is not hired yet");
  return overview;
}

/** What the start form shows after a submit that did not finish. */
export interface OnboardFormState {
  /** Counts submits, so the form remounts with the values below. */
  attempt: number;
  websiteUrl: string;
  errors: { websiteUrl?: string; form?: string };
  /** Out of credits: where to top up before starting again. */
  topUpUrl?: string;
}

/**
 * Hiring Cuso's start form: the website, then Core hires Cuso into a new
 * organization named after it.
 */
export async function onboard(
  previous: OnboardFormState,
  formData: FormData,
): Promise<OnboardFormState> {
  const typed = String(formData.get("websiteUrl") ?? "").trim();
  const result = { attempt: previous.attempt + 1, websiteUrl: typed };

  const websiteUrl = normalizeWebsiteUrl(typed);
  if (!websiteUrl) {
    return {
      ...result,
      errors: { websiteUrl: "Enter a website, like acme.com." },
    };
  }

  const core = await requireCore();
  const { error } = await startCmoOnboarding({
    ...core,
    body: { websiteUrl },
  });
  if (error) {
    if (/credits/i.test(errorText(error, ""))) {
      return {
        ...result,
        errors: {
          form: "You're out of credits. Top up on Sokosumi, then press Start again.",
        },
        topUpUrl: `${readSokosumiAppBaseUrl()}/billing`,
      };
    }
    return { ...result, errors: { form: "That did not work. Try again." } };
  }
  revalidatePath("/");
  return { ...result, errors: {} };
}

/**
 * Approves the newest strategy version, or the one named (going back to it),
 * on the Project's Marketing strategy.
 */
export async function approveStrategy(
  versionId?: string,
): Promise<CmoOverview> {
  const { overview, ...options } = await cusoProject();
  const strategyId = versionId ?? overview.strategyVersion?.id;
  if (!strategyId) throw new Error("There is no strategy to approve yet");
  const { error } = await approveProjectMarketingStrategy({
    ...options,
    path: { ...options.path, strategyId },
  });
  if (error)
    throw new Error(errorText(error, "Could not approve the strategy"));
  return requireOverview();
}

/** A member confirmed the Project's Brand Brain; Cuso's questions come next. */
export async function approveBrandBrain(): Promise<CmoOverview> {
  const { overview: _overview, ...options } = await cusoProject();
  const { error } = await confirmProjectBrandBrain(options);
  if (error) {
    throw new Error(errorText(error, "Could not approve the Brand Brain"));
  }
  return requireOverview();
}

/** One answer to one of Cuso's questions: yes, no (with what is true) or not sure. */
export async function answerBrandQuestion(answer: {
  questionId: string;
  answer: "yes" | "no" | "unsure";
  note?: string;
}): Promise<CmoOverview> {
  const { overview: _overview, ...options } = await cusoProject();
  const { error } = await answerProjectBrandBrainQuestion({
    ...options,
    body: answer,
  });
  if (error) throw new Error(errorText(error, "Could not save the answer"));
  return requireOverview();
}

/** One answer to one of the newest plan's yes/no questions. */
export async function answerPlanQuestion(answer: {
  questionId: string;
  answer: "yes" | "no" | "unsure";
  note?: string;
}): Promise<CmoOverview> {
  const { overview, ...options } = await cusoProject();
  const strategyId = overview.strategyVersion?.id;
  if (!strategyId) throw new Error("There is no strategy yet");
  const { error } = await answerProjectMarketingStrategyQuestion({
    ...options,
    path: { ...options.path, strategyId },
    body: answer,
  });
  if (error) throw new Error(errorText(error, "Could not save the answer"));
  return requireOverview();
}

/** Cuso fits the plan to the owner's answers. */
export async function applyPlanAnswers(): Promise<{
  overview: CmoOverview | null;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await applyCmoPlanAnswers(core);
  return {
    overview: await loadOverview(),
    error: error ? errorText(error, "Could not update the plan") : null,
  };
}

/** The owner's own edit to the Brand Brain, saved as written. */
export async function saveBrandBrain(
  brandBrain: NonNullable<CmoOverview["brandBrain"]>,
): Promise<CmoOverview> {
  const { overview: _overview, ...options } = await cusoProject();
  const { error } = await updateProjectBrandBrain({
    ...options,
    body: { brandBrain },
  });
  if (error)
    throw new Error(errorText(error, "Could not save the Brand Brain"));
  return requireOverview();
}

export async function pauseEntry(id: string): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await pauseCmoCalendarEntry({ ...core, path: { id } });
  if (!data) throw new Error("Could not pause this entry");
  return data.data;
}

/** Starts learning again; a refusal (such as no credits) comes back as text. */
export async function retryLearning(): Promise<{
  overview: CmoOverview;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await retryCmoOnboarding(core);
  const { data } = await getCmoOverview(core);
  if (!data) throw new Error("Could not load CMO");
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : null;
  return {
    overview: data.data,
    error: error ? (message ?? "Could not start") : null,
  };
}

export async function revertUpdate(id: string): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await revertCmoUpdate({ ...core, path: { id } });
  if (!data) throw new Error("Could not revert the changes");
  return data.data;
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
export async function loadMessages(): Promise<CusoMessage[]> {
  const core = await requireCore();
  const overview = await loadOverview();
  if (!overview) return [];
  return messagesFor(core, overview);
}

/** Overview and messages in one go, for the app's polling. */
export async function loadState(): Promise<{
  overview: CmoOverview | null;
  messages: CusoMessage[];
}> {
  const core = await requireCore();
  const { data, response } = await getCmoOverview(core);
  if (response?.status === 404 || !data)
    return { overview: null, messages: [] };
  return {
    overview: data.data,
    messages: await messagesFor(core, data.data),
  };
}

export async function sendMessage(content: string): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const core = await requireCore();
  const overview = await loadOverview();
  if (!overview) throw new Error("Cuso is not hired yet");
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
export async function requestStrategy(note?: string): Promise<{
  overview: CmoOverview | null;
  error: string | null;
}> {
  const core = await requireCore();
  const { error } = await requestCmoStrategy({
    ...core,
    body: note?.trim() ? { note: note.trim() } : {},
  });
  return {
    overview: await loadOverview(),
    error: error ? errorText(error, "Could not start planning") : null,
  };
}

/** The owner's own monthly ad budget; Cuso re-plans the ads around it. */
export async function setAdBudget(
  monthly: number,
  currency: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { error } = await setCmoAdBudget({
    ...core,
    body: { monthly, currency },
  });
  return {
    overview: await loadOverview(),
    error: error ? errorText(error, "Could not set the budget") : null,
  };
}

/** Activates a CMO tier without checkout (Core's CMO_MOCK_BILLING). */
export async function chooseMockPlan(
  plan: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await chooseCmoMockPlan({ ...core, body: { plan } });
  if (!data) {
    return {
      overview: null,
      error: errorText(error, "Could not pick that plan"),
    };
  }
  revalidatePath("/");
  return { overview: data.data, error: null };
}

/**
 * The founder moved on from the Accounts step. A connection already counts;
 * skipping is the person's preference, so a reload resumes on the plan.
 */
export async function finishAccounts(): Promise<CmoOverview> {
  const core = await requireCore();
  const { error } = await patchUsersByIdPreferences({
    ...core,
    path: { id: "me" },
    body: { cmoAccountsSkipped: true },
  });
  if (error) throw new Error(errorText(error, "Could not continue"));
  return requireOverview();
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
  text: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const overview = await loadOverview();
  if (!overview) return { overview: null, error: "Cuso is not hired yet" };
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
  return { overview: await loadOverview(), error: null };
}

/** The founder is done with onboarding: CMO opens on the chat. */
export async function completeOnboarding(): Promise<void> {
  const core = await requireCore();
  const { error } = await completeCmoOnboarding(core);
  if (error) throw new Error(errorText(error, "Could not finish onboarding"));
  revalidatePath("/");
}

/** Where the provider sends the founder back after connecting. */
async function callbackUrl(path = "/connect/callback"): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
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

/**
 * Request options for Cuso's Project on the standard Project routes, with
 * the overview they were read from.
 */
async function cusoProject() {
  const overview = await requireOverview();
  return {
    overview,
    ...(await inCusoWorkspace(overview)),
    path: { id: overview.projectId },
  };
}

/** Starts connecting a network; the browser goes to the returned URL. */
export async function connectChannel(
  provider: "x" | "linkedin" | "instagram" | "facebook" | "youtube",
): Promise<{ url: string | null; error: string | null }> {
  const { overview: _overview, ...options } = await cusoProject();
  const { data, error } = await postProjectsByIdSocialConnectionsInitiate({
    ...options,
    body: { action: "connect", provider, callbackUrl: await callbackUrl() },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/** Finishes a connection after the provider sent the founder back. */
export async function finalizeChannel(connectionId: string): Promise<boolean> {
  const { overview: _overview, ...options } = await cusoProject();
  const { error } = await postProjectsByIdSocialConnectionsFinalize({
    ...options,
    body: { connectionId },
  });
  return !error;
}

/** Starts connecting a measurement source to Cuso; the browser goes to the returned URL. */
export async function connectMeasurement(
  provider: CmoMeasurement["provider"],
  from: "onboarding" | "app",
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const query = new URLSearchParams({ provider, from });
  const { data, error } = await connectCmoMeasurement({
    ...core,
    path: { provider },
    body: { returnUrl: await callbackUrl(`/measure/callback?${query}`) },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/** Finishes a measurement connection after the founder signed in. */
export async function finalizeMeasurement(
  provider: CmoMeasurement["provider"],
): Promise<boolean> {
  const core = await requireCore();
  const { error } = await finalizeCmoMeasurement({
    ...core,
    path: { provider },
  });
  return !error;
}

/** Sokosumi's subscription plans, as Core prices them. */
export async function loadPlans(): Promise<SubscriptionCatalog | null> {
  const core = await requireCore();
  const { data } = await getSubscriptionCatalog(core);
  return data?.data ?? null;
}
