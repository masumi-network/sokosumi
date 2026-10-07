"use server";

import {
  approveCmoStrategy,
  type CmoOverview,
  chooseCmoMockPlan,
  completeCmoOnboarding,
  connectCmoChannel,
  finalizeCmoChannel,
  finishCmoAccountsStep,
  getChatsRoomsByIdMessages,
  getCmoOverview,
  getSubscriptionCatalog,
  pauseCmoCalendarEntry,
  postChatsRoomsByIdMessages,
  requestCmoStrategy,
  retryCmoOnboarding,
  revertCmoUpdate,
  type SubscriptionCatalog,
  startCmoOnboarding,
} from "@sokosumi/core-client";
import { normalizeWebsiteUrl } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { type CusoMessage, toCusoMessages } from "../lib/chat-messages";
import { coreForCurrentUser } from "../lib/core";

async function requireCore() {
  const core = await coreForCurrentUser();
  if (!core) throw new Error("Not signed in to Sokosumi");
  return core;
}

/** The person's CMO workspace, or null before onboarding. */
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
}

/**
 * Hiring Cuso's start form: the website by the same rule as identity
 * onboarding's organization step, then Core hires Cuso into the workspace.
 */
export async function onboard(
  previous: OnboardFormState,
  formData: FormData,
): Promise<OnboardFormState> {
  const typed = String(formData.get("websiteUrl") ?? "").trim();
  const goals = String(formData.get("goals") ?? "").trim();
  const workspaceId = String(formData.get("workspaceId") ?? "");
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
    body: { workspaceId, websiteUrl, goals },
  });
  if (error) {
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
  if (!data) throw new Error("Could not load the CMO workspace");
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
  if (!overview) throw new Error("No CMO workspace yet");
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

/** The founder is done with onboarding: CMO opens on the chat. */
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

export async function completeOnboarding(): Promise<void> {
  const core = await requireCore();
  const { error } = await completeCmoOnboarding(core);
  if (error) throw new Error(errorText(error, "Could not finish onboarding"));
  revalidatePath("/");
}

/** Where the provider sends the founder back after connecting. */
async function callbackUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/connect/callback`;
}

/** Starts connecting a network; the browser goes to the returned URL. */
export async function connectChannel(
  provider: "x" | "linkedin" | "instagram" | "facebook" | "tiktok" | "youtube",
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

/** Sokosumi's subscription plans, as Core prices them. */
export async function loadPlans(): Promise<SubscriptionCatalog | null> {
  const core = await requireCore();
  const { data } = await getSubscriptionCatalog(core);
  return data?.data ?? null;
}
