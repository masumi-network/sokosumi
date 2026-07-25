import { CHAT_MODELS } from "@sokosumi/chat";

import {
  type CoworkerCapability,
  coworkerCanChat,
  coworkerCanHandleTasks,
} from "./coworker-utils";
import type { ChatComposeKind, Coworker } from "./types";

export const WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY =
  "sokosumi-welcome-compose-prefs";

export type WelcomeComposeStoredV1 = {
  v: 1;
  composeKind: ChatComposeKind;
  modelId: string | null;
  coworkerSlugOrId: string | null;
};

function isChatComposeKind(v: unknown): v is ChatComposeKind {
  return v === "chat" || v === "task";
}

function firstCoworkerWithCapability(
  coworkers: Coworker[],
  capability: CoworkerCapability,
): Coworker | null {
  return coworkers.find((x) => coworkerCanUseCapability(x, capability)) ?? null;
}

function coworkerCanUseCapability(
  coworker: Coworker,
  capability: CoworkerCapability,
): boolean {
  if (capability === "chat") {
    return coworkerCanChat(coworker);
  }

  return coworkerCanHandleTasks(coworker);
}

export function readWelcomeComposePreferences(): WelcomeComposeStoredV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
    );
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { v?: unknown }).v !== 1
    ) {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    const composeKind = o.composeKind;
    if (!isChatComposeKind(composeKind)) return null;
    const modelId =
      typeof o.modelId === "string" && o.modelId.length > 0 ? o.modelId : null;
    const coworkerSlugOrId =
      typeof o.coworkerSlugOrId === "string" && o.coworkerSlugOrId.length > 0
        ? o.coworkerSlugOrId
        : null;
    return { v: 1, composeKind, modelId, coworkerSlugOrId };
  } catch {
    return null;
  }
}

export function writeWelcomeComposePreferences(
  snapshot: Omit<WelcomeComposeStoredV1, "v">,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: WelcomeComposeStoredV1 = { v: 1, ...snapshot };
    window.localStorage.setItem(
      WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Ignore quota / private mode.
  }
}

export function buildWelcomeComposeStoredSnapshot(p: {
  composeKind: ChatComposeKind;
  coworker: Coworker | null;
  model: { id: string; name: string } | null;
}): WelcomeComposeStoredV1 {
  const modelId =
    p.composeKind === "chat" && p.model != null ? p.model.id : null;
  const coworkerSlugOrId =
    p.coworker != null ? p.coworker.slug || p.coworker.id : null;
  return {
    v: 1,
    composeKind: p.composeKind,
    modelId,
    coworkerSlugOrId,
  };
}

export function resolveHydratedWelcomeSelection(
  coworkers: Coworker[],
  stored: WelcomeComposeStoredV1 | null,
  options: { urlCoworkerSlug: boolean },
): {
  composeKind: ChatComposeKind;
  coworker: Coworker | null;
  model: { id: string; name: string } | null;
} {
  const defaultCompose: ChatComposeKind = "chat";
  if (!stored) {
    return {
      composeKind: defaultCompose,
      coworker: null,
      model: null,
    };
  }

  const composeKind: ChatComposeKind = "chat";

  if (options.urlCoworkerSlug) {
    return { composeKind, coworker: null, model: null };
  }

  if (stored.modelId) {
    const model = CHAT_MODELS.find((m) => m.id === stored.modelId);
    if (model) {
      return {
        composeKind: "chat",
        coworker: null,
        model: { id: model.id, name: model.name },
      };
    }
  }

  const key = stored.coworkerSlugOrId;
  if (key) {
    const c = coworkers.find(
      (x) =>
        x.id === key ||
        x.slug?.toLowerCase() === key.toLowerCase() ||
        x.id.toLowerCase() === key.toLowerCase(),
    );
    if (c) {
      if (coworkerCanUseCapability(c, "chat")) {
        return { composeKind: "chat", coworker: c, model: null };
      }
      return {
        composeKind: "chat",
        coworker: firstCoworkerWithCapability(coworkers, "chat"),
        model: null,
      };
    }
  }

  return {
    composeKind: "chat",
    coworker: firstCoworkerWithCapability(coworkers, "chat"),
    model: null,
  };
}
