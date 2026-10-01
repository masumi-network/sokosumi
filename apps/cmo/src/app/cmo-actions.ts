"use server";

import {
  type CmoBrandBrainRequest,
  type CmoOverview,
  getChatsRoomsByIdMessages,
  getCmoOverview,
  postChatsRoomsByIdMessages,
  requestCmoStrategy,
  startCmoOnboarding,
  updateCmoBrandBrain,
  updateCmoStrategySettings,
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

export async function onboard(formData: FormData): Promise<void> {
  const core = await requireCore();
  const websiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  const goals = String(formData.get("goals") ?? "").trim();
  const businessName =
    String(formData.get("businessName") ?? "").trim() || undefined;
  const { error } = await startCmoOnboarding({
    ...core,
    body: { websiteUrl, goals, businessName },
  });
  if (error) throw new Error("Could not start CMO");
  revalidatePath("/");
}

export async function saveBrandBrain(
  brandBrain: CmoBrandBrainRequest["brandBrain"],
): Promise<void> {
  const core = await requireCore();
  const { error } = await updateCmoBrandBrain({
    ...core,
    body: { brandBrain },
  });
  if (error) throw new Error("Could not save the Brand Brain");
  revalidatePath("/");
}

export async function planMonth(formData: FormData): Promise<void> {
  const core = await requireCore();
  const note = String(formData.get("note") ?? "").trim() || undefined;
  const { error } = await requestCmoStrategy({ ...core, body: { note } });
  if (error) throw new Error("Cuso could not start the plan yet");
  revalidatePath("/");
}

export async function setAutonomy(formData: FormData): Promise<void> {
  const core = await requireCore();
  const channel = String(formData.get("channel") ?? "");
  const autonomy = String(formData.get("autonomy") ?? "");
  if (autonomy !== "drafts" && autonomy !== "ask" && autonomy !== "autopilot") {
    throw new Error("Unknown autonomy");
  }
  const { error } = await updateCmoStrategySettings({
    ...core,
    body: { channels: [{ channel, autonomy }] },
  });
  if (error) throw new Error("Could not save the setting");
  revalidatePath("/");
}

async function chatScope() {
  const core = await requireCore();
  const overview = await loadOverview();
  if (!overview) throw new Error("No CMO workspace yet");
  return {
    core,
    overview,
    headers: {
      ...core.headers,
      "X-Organization-Slug": overview.organizationSlug,
    },
  };
}

/** The latest messages with Cuso, oldest first. */
export async function loadMessages(): Promise<CusoMessage[]> {
  const { core, overview, headers } = await chatScope();
  const { data } = await getChatsRoomsByIdMessages({
    client: core.client,
    headers,
    path: { id: overview.roomId },
    query: { limit: 50 },
  });
  return toCusoMessages(data?.data ?? []);
}

export async function sendMessage(content: string): Promise<void> {
  const text = content.trim();
  if (!text) return;
  const { core, overview, headers } = await chatScope();
  const { error } = await postChatsRoomsByIdMessages({
    client: core.client,
    headers,
    path: { id: overview.roomId },
    body: { content: text, mentionedSokoBotIds: [overview.sokoBotId] },
  });
  if (error) throw new Error("Could not send the message");
}
