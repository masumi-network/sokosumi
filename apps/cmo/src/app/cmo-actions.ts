"use server";

import {
  approveCmoStrategy,
  type CmoOverview,
  getChatsRoomsByIdMessages,
  getCmoOverview,
  pauseCmoCalendarEntry,
  postChatsRoomsByIdMessages,
  retryCmoOnboarding,
  revertCmoUpdate,
  startCmoOnboarding,
} from "@sokosumi/core-client";
import { revalidatePath } from "next/cache";

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

/** "acme.io" or "https://acme.io/" both become a full URL. */
export async function normalizeWebsite(value: string): Promise<string> {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function onboard(formData: FormData): Promise<void> {
  const core = await requireCore();
  const websiteUrl = await normalizeWebsite(
    String(formData.get("websiteUrl") ?? ""),
  );
  const goals = String(formData.get("goals") ?? "").trim();
  const { error } = await startCmoOnboarding({
    ...core,
    body: { websiteUrl, goals },
  });
  if (error) throw new Error("Could not start CMO");
  revalidatePath("/");
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
