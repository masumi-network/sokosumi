import { afterEach, describe, expect, it } from "vitest";

import type { Coworker } from "../types";
import {
  buildWelcomeComposeStoredSnapshot,
  readWelcomeComposePreferences,
  resolveHydratedWelcomeSelection,
  WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
  writeWelcomeComposePreferences,
} from "../welcome-compose-preferences";

function baseCoworker(over: Partial<Coworker> = {}): Coworker {
  return {
    id: "cow_1",
    name: "Alex",
    description: "d",
    useCase: "u",
    slug: "alex",
    ...over,
  };
}

describe("readWelcomeComposePreferences", () => {
  afterEach(() => {
    window.localStorage.removeItem(WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY);
  });

  it("returns null for missing, invalid JSON, wrong version, or invalid composeKind", () => {
    expect(readWelcomeComposePreferences()).toBeNull();
    window.localStorage.setItem(WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY, "{");
    expect(readWelcomeComposePreferences()).toBeNull();
    window.localStorage.setItem(
      WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ v: 2, composeKind: "chat" }),
    );
    expect(readWelcomeComposePreferences()).toBeNull();
    window.localStorage.setItem(
      WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        composeKind: "email",
        modelId: null,
        coworkerSlugOrId: null,
      }),
    );
    expect(readWelcomeComposePreferences()).toBeNull();
  });

  it("parses a valid v1 payload", () => {
    window.localStorage.setItem(
      WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        composeKind: "task",
        modelId: "x",
        coworkerSlugOrId: "alex",
      }),
    );
    expect(readWelcomeComposePreferences()).toEqual({
      v: 1,
      composeKind: "task",
      modelId: "x",
      coworkerSlugOrId: "alex",
    });
  });
});

describe("writeWelcomeComposePreferences", () => {
  afterEach(() => {
    window.localStorage.removeItem(WELCOME_COMPOSE_PREFERENCES_STORAGE_KEY);
  });

  it("round-trips through readWelcomeComposePreferences", () => {
    writeWelcomeComposePreferences({
      composeKind: "chat",
      modelId: "kimi-k2-5",
      coworkerSlugOrId: null,
    });
    expect(readWelcomeComposePreferences()).toMatchObject({
      v: 1,
      composeKind: "chat",
      modelId: "kimi-k2-5",
      coworkerSlugOrId: null,
    });
  });
});

describe("buildWelcomeComposeStoredSnapshot", () => {
  it("stores model id only for chat compose", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "task",
        coworker: baseCoworker(),
        model: { id: "kimi-k2-5", name: "Kimi" },
      }).modelId,
    ).toBeNull();
  });

  it("stores coworker slug when present", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: baseCoworker({ slug: "pat", id: "id-1" }),
        model: null,
      }).coworkerSlugOrId,
    ).toBe("pat");
  });

  it("falls back to coworker id when slug is empty", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: baseCoworker({ slug: "", id: "only-id" }),
        model: null,
      }).coworkerSlugOrId,
    ).toBe("only-id");
  });
});

describe("resolveHydratedWelcomeSelection", () => {
  const coworkers = [
    baseCoworker({ id: "a", slug: "alex", capabilities: ["chat", "tasks"] }),
    baseCoworker({
      id: "b",
      slug: "no-tasks",
      capabilities: ["chat"],
    }),
    baseCoworker({
      id: "c",
      slug: "tasky",
      capabilities: ["tasks"],
    }),
  ];

  it("returns defaults when stored is null", () => {
    expect(
      resolveHydratedWelcomeSelection(coworkers, null, {
        urlCoworkerSlug: false,
      }),
    ).toEqual({
      composeKind: "chat",
      coworker: null,
      model: null,
    });
  });

  it("resolves a stored chat model id", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: "kimi-k2-5",
      coworkerSlugOrId: "alex",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker).toBeNull();
    expect(r.model).toEqual({ id: "kimi-k2-5", name: "Kimi K2.5" });
  });

  it("when urlCoworkerSlug is true, keeps composeKind but clears model and coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: "alex",
    };
    expect(
      resolveHydratedWelcomeSelection(coworkers, stored, {
        urlCoworkerSlug: true,
      }),
    ).toEqual({
      composeKind: "task",
      coworker: null,
      model: null,
    });
  });

  it("falls back from invalid model id to coworker match", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: "unknown-model",
      coworkerSlugOrId: "alex",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.model).toBeNull();
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for task compose, picks a tasks-capable fallback when stored coworker cannot do tasks", () => {
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: "no-tasks",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("task");
    expect(r.coworker?.capabilities?.includes("tasks")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });
});
