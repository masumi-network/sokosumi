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
  const capabilities = over.capabilities ?? [];
  return {
    id: "cow_1",
    name: "Alex",
    description: "d",
    useCase: "u",
    slug: "alex",
    capabilities,
    archivedAt: null,
    isWhitelisted: true,
    canChat: capabilities.includes("chat"),
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
      modelId: null,
      coworkerSlugOrId: "alex",
    });
    expect(readWelcomeComposePreferences()).toMatchObject({
      v: 1,
      composeKind: "chat",
      modelId: null,
      coworkerSlugOrId: "alex",
    });
  });
});

describe("buildWelcomeComposeStoredSnapshot", () => {
  it("never stores a model id", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: null,
      }).modelId,
    ).toBeNull();
  });

  it("stores coworker slug when present", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: baseCoworker({ slug: "pat", id: "id-1" }),
      }).coworkerSlugOrId,
    ).toBe("pat");
  });

  it("falls back to coworker id when slug is empty", () => {
    expect(
      buildWelcomeComposeStoredSnapshot({
        composeKind: "chat",
        coworker: baseCoworker({ slug: "", id: "only-id" }),
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
    });
  });

  it("ignores a stored chat model id and resolves coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: "kimi-k2-6",
      coworkerSlugOrId: "alex",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.slug).toBe("alex");
  });

  it("when urlCoworkerSlug is true, migrates task to chat and clears coworker", () => {
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
      composeKind: "chat",
      coworker: null,
    });
  });

  it("for task compose, migrates to chat and picks a chat-capable fallback", () => {
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: "no-tasks",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("no-tasks");
  });

  it("for task compose with null coworkerSlugOrId, migrates to chat and picks first chat-capable coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: null,
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for task compose when stored coworker id/slug is unknown, migrates to chat and picks first chat-capable coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: "missing-coworker",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for task compose with chat-only coworkers, migrates to chat and picks the chat-capable coworker", () => {
    const chatOnly = [
      baseCoworker({ id: "b", slug: "no-tasks", capabilities: ["chat"] }),
    ];
    const stored = {
      v: 1 as const,
      composeKind: "task" as const,
      modelId: null,
      coworkerSlugOrId: null,
    };
    const r = resolveHydratedWelcomeSelection(chatOnly, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.slug).toBe("no-tasks");
  });

  it("for chat compose, picks a chat-capable fallback when stored coworker cannot chat", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: null,
      coworkerSlugOrId: "tasky",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for chat compose, skips stored coworker without runnable chat endpoint", () => {
    const coworkersWithUnavailableChat = [
      baseCoworker({
        id: "a",
        slug: "alex",
        capabilities: ["chat"],
        canChat: false,
      }),
      baseCoworker({
        id: "h",
        slug: "hannah",
        capabilities: ["chat"],
      }),
    ];
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: null,
      coworkerSlugOrId: "alex",
    };
    const r = resolveHydratedWelcomeSelection(
      coworkersWithUnavailableChat,
      stored,
      {
        urlCoworkerSlug: false,
      },
    );
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.slug).toBe("hannah");
  });

  it("for chat compose with null coworkerSlugOrId, picks first chat-capable coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: null,
      coworkerSlugOrId: null,
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for chat compose with only a stored modelId, ignores model and picks first chat-capable coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: "kimi-k2-6",
      coworkerSlugOrId: null,
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for chat compose when stored coworker id/slug is unknown, picks first chat-capable coworker", () => {
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: null,
      coworkerSlugOrId: "missing-coworker",
    };
    const r = resolveHydratedWelcomeSelection(coworkers, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker?.capabilities?.includes("chat")).toBe(true);
    expect(r.coworker?.slug).toBe("alex");
  });

  it("for chat compose with no chat-capable coworkers, returns null coworker", () => {
    const taskOnly = [
      baseCoworker({ id: "c", slug: "tasky", capabilities: ["tasks"] }),
    ];
    const stored = {
      v: 1 as const,
      composeKind: "chat" as const,
      modelId: null,
      coworkerSlugOrId: null,
    };
    const r = resolveHydratedWelcomeSelection(taskOnly, stored, {
      urlCoworkerSlug: false,
    });
    expect(r.composeKind).toBe("chat");
    expect(r.coworker).toBeNull();
  });
});
