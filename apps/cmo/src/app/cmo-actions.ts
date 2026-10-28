"use server";

import {
  answerCmoBrandQuestion,
  approveCmoBrandBrain,
  approveCmoStrategy,
  type CmoMeasurement,
  type CmoOverview,
  chooseCmoMockPlan,
  completeCmoOnboarding,
  connectCmoChannel,
  connectCmoMeasurement,
  finalizeCmoChannel,
  finalizeCmoMeasurement,
  finishCmoAccountsStep,
  getChatsRoomsByIdMessages,
  getCmoOverview,
  getSubscriptionCatalog,
  importCmoMailingList,
  pauseCmoCalendarEntry,
  postChatsRoomsByIdMessages,
  requestCmoStrategy,
  retryCmoOnboarding,
  revertCmoUpdate,
  type SubscriptionCatalog,
  setCmoAdBudget,
  startCmoOnboarding,
  updateCmoBrandBrain,
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

/** The person's CMO hire, or null before they hire Cuso. */
export async function loadOverview(): Promise<CmoOverview | null> {
  const core = await requireCore();
  const { data, response } = await getCmoOverview(core);
  if (response?.status === 404) return null;
  if (!data) throw new Error("Could not load CMO");
  return data.data;
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

export async function approveStrategy(): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await approveCmoStrategy(core);
  if (!data) throw new Error("Could not approve the strategy");
  return data.data;
}

/** The owner approved the Brand Brain; Cuso's questions come next. */
export async function approveBrandBrain(): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await approveCmoBrandBrain(core);
  if (!data) throw new Error("Could not approve the Brand Brain");
  return data.data;
}

/** One answer to one of Cuso's questions: yes, no (with what is true) or not sure. */
export async function answerBrandQuestion(answer: {
  questionId: string;
  answer: "yes" | "no" | "unsure";
  note?: string;
}): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await answerCmoBrandQuestion({ ...core, body: answer });
  if (!data) throw new Error("Could not save the answer");
  return data.data;
}

/** The owner's own edit to the Brand Brain, saved as written. */
export async function saveBrandBrain(
  brandBrain: NonNullable<CmoOverview["brandBrain"]>,
): Promise<CmoOverview> {
  const core = await requireCore();
  const { data } = await updateCmoBrandBrain({ ...core, body: { brandBrain } });
  if (!data) throw new Error("Could not save the Brand Brain");
  return data.data;
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

/** The founder connected or skipped the Accounts step. */
export async function finishAccounts(): Promise<CmoOverview> {
  const core = await requireCore();
  const { data, error } = await finishCmoAccountsStep(core);
  if (!data) throw new Error(errorText(error, "Could not continue"));
  return data.data;
}

/** Adds the founder's mailing list for the newsletter Cuso writes. */
export async function addMailingList(
  text: string,
): Promise<{ overview: CmoOverview | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await importCmoMailingList({
    ...core,
    body: { text },
  });
  if (!data) {
    return {
      overview: null,
      error: errorText(error, "Could not add the list"),
    };
  }
  return { overview: data.data, error: null };
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

/** Starts connecting a network; the browser goes to the returned URL. */
export async function connectChannel(
  provider: "x" | "linkedin" | "instagram" | "facebook" | "youtube",
): Promise<{ url: string | null; error: string | null }> {
  const core = await requireCore();
  const { data, error } = await connectCmoChannel({
    ...core,
    body: { provider, callbackUrl: await callbackUrl() },
  });
  if (!data) {
    return { url: null, error: errorText(error, "Could not start connecting") };
  }
  return { url: data.data.redirectUrl, error: null };
}

/** Finishes a connection after the provider sent the founder back. */
export async function finalizeChannel(connectionId: string): Promise<boolean> {
  const core = await requireCore();
  const { error } = await finalizeCmoChannel({
    ...core,
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
