import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  buildComposioCallbackInlineScript,
  COMPOSIO_BOT_ID_STORAGE_KEY,
  COMPOSIO_OAUTH_ACK_TYPE,
  COMPOSIO_OAUTH_BROADCAST_CHANNEL,
  COMPOSIO_OAUTH_MESSAGE_TYPE,
  COMPOSIO_OAUTH_NONCE_STORAGE_KEY,
  getComposioOAuthPopupName,
  isComposioOAuthAckPayload,
  isComposioOAuthCallbackPayload,
  parseComposioCallbackSearchParams,
  rememberComposioBotId,
} from "@/lib/composio/oauth-popup-protocol";

describe("oauth-popup-protocol", () => {
  it("recognizes callback payloads", () => {
    expect(
      isComposioOAuthCallbackPayload({
        type: COMPOSIO_OAUTH_MESSAGE_TYPE,
        status: "success",
        connectionId: "conn_1",
        sessionUri: null,
        errorMessage: null,
        nonce: "nonce_123",
      }),
    ).toBe(true);
    expect(
      isComposioOAuthCallbackPayload({
        type: COMPOSIO_OAUTH_MESSAGE_TYPE,
        status: "success",
        connectionId: "conn_1",
        sessionUri: null,
        errorMessage: null,
      }),
    ).toBe(false);
    expect(isComposioOAuthCallbackPayload({ type: "other" })).toBe(false);
  });

  it("recognizes ack payloads", () => {
    expect(
      isComposioOAuthAckPayload({
        type: COMPOSIO_OAUTH_ACK_TYPE,
        nonce: "nonce_123",
      }),
    ).toBe(true);
  });

  it("parses Composio callback query params", () => {
    expect(
      parseComposioCallbackSearchParams(
        "?status=success&connected_account_id=ca_123",
      ),
    ).toEqual({
      status: "success",
      connectionId: "ca_123",
      sessionUri: null,
      errorMessage: null,
    });
    expect(
      parseComposioCallbackSearchParams("?id=ca_456&error=access_denied"),
    ).toEqual({
      status: "error",
      connectionId: "ca_456",
      sessionUri: null,
      errorMessage: "access_denied",
    });
    expect(
      parseComposioCallbackSearchParams(
        "?status=failed&connected_account_id=ca_failed",
      ),
    ).toEqual({
      status: "error",
      connectionId: "ca_failed",
      sessionUri: null,
      errorMessage: null,
    });
    expect(
      parseComposioCallbackSearchParams(
        "?status=expired&connectionId=ca_expired",
      ),
    ).toEqual({
      status: "error",
      connectionId: "ca_expired",
      sessionUri: null,
      errorMessage: null,
    });
    expect(
      parseComposioCallbackSearchParams(
        "?session_uri=https%3A%2F%2Fbackend.composio.dev%2Fsession%2Fsingle-use",
      ),
    ).toEqual({
      status: "success",
      connectionId: null,
      sessionUri: "https://backend.composio.dev/session/single-use",
      errorMessage: null,
    });
    expect(parseComposioCallbackSearchParams("?foo=bar")).toEqual({
      status: "error",
      connectionId: null,
      sessionUri: null,
      errorMessage: null,
    });
  });

  it("builds a self-contained inline callback script", () => {
    const script = buildComposioCallbackInlineScript();
    expect(script).toContain(COMPOSIO_OAUTH_BROADCAST_CHANNEL);
    expect(script).toContain("BroadcastChannel");
    expect(script).toContain("window.name");
    expect(script).toContain("nonce:nonce");
    expect(script).toContain("window.close");
  });

  it("isolates BroadcastChannel failures from opener postMessage delivery", () => {
    const script = buildComposioCallbackInlineScript();
    expect(script).toContain('typeof BroadcastChannel!=="undefined"');
    // Opener delivery must run after the BroadcastChannel try/catch, not inside it.
    expect(script).toMatch(/\}catch\(e\)\{\}\s*if\(window\.opener\)/);
  });
});

describe("callback delivery after cross-site navigation", () => {
  it.each([
    { source: "session storage", storedNonce: "attempt-123", name: "" },
    {
      source: "popup name",
      storedNonce: null,
      name: getComposioOAuthPopupName("attempt-123"),
    },
  ])(
    "delivers the $source nonce without redirecting to the bot verifier",
    ({ storedNonce, name }) => {
      const postMessage = vi.fn();
      const close = vi.fn();
      const channels: string[] = [];
      const getItem = vi.fn(() => storedNonce);
      const replace = vi.fn();
      const removeItem = vi.fn();
      class CallbackChannel {
        constructor(name: string) {
          channels.push(name);
        }
        postMessage = postMessage;
        close = vi.fn();
      }

      runInNewContext(buildComposioCallbackInlineScript(), {
        URLSearchParams,
        BroadcastChannel: CallbackChannel,
        setTimeout: vi.fn(),
        window: {
          sessionStorage: { getItem, removeItem },
          name,
          opener: null,
          location: {
            origin: "https://app.sokosumi.com",
            replace,
            search:
              "?session_uri=https%3A%2F%2Fbackend.composio.dev%2Fsession%2Fone-use",
          },
          addEventListener: vi.fn(),
          close,
        },
      });

      expect(channels).toEqual([
        `${COMPOSIO_OAUTH_BROADCAST_CHANNEL}:attempt-123`,
      ]);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          nonce: "attempt-123",
          connectionId: null,
          sessionUri: "https://backend.composio.dev/session/one-use",
          status: "success",
        }),
      );
      expect(getItem).toHaveBeenCalledWith(COMPOSIO_OAUTH_NONCE_STORAGE_KEY);
      expect(removeItem).toHaveBeenCalledWith(COMPOSIO_OAUTH_NONCE_STORAGE_KEY);
      expect(close).toHaveBeenCalledOnce();
      expect(replace).not.toHaveBeenCalled();
    },
  );
});

describe("same-tab Composio verification", () => {
  it.each(["session_uri", "sessionUri"])(
    "forwards %s to the signed-in bot verifier without using popup delivery",
    (parameter) => {
      const sessionUri =
        "session_token&returnUrl=https://untrusted.example/?a=1#fragment";
      const replace = vi.fn();
      const postMessage = vi.fn();
      const close = vi.fn();
      const broadcast = vi.fn();
      const query = new URLSearchParams({
        [parameter]: sessionUri,
        returnUrl: "https://untrusted.example/",
        userId: "someone-else",
      });

      runInNewContext(buildComposioCallbackInlineScript(), {
        URLSearchParams,
        BroadcastChannel: broadcast,
        setTimeout: vi.fn(),
        window: {
          sessionStorage: { getItem: () => null, removeItem: vi.fn() },
          name: "",
          opener: { postMessage },
          location: {
            origin: "https://preprod.sokosumi.com",
            search: `?${query}`,
            replace,
          },
          addEventListener: vi.fn(),
          close,
        },
      });

      expect(replace).toHaveBeenCalledExactlyOnceWith(
        `/personal-assistant/integrations/verify?session_uri=${encodeURIComponent(sessionUri)}`,
      );
      expect(broadcast).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    },
  );

  it("does not redeem a callback without a session or popup nonce", () => {
    const replace = vi.fn();
    runInNewContext(buildComposioCallbackInlineScript(), {
      URLSearchParams,
      window: {
        sessionStorage: { getItem: () => null, removeItem: vi.fn() },
        name: "",
        location: { search: "?status=success", replace },
      },
    });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("same-tab verification for a shared Soko Bot", () => {
  const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

  function runCallback(stored: Record<string, string>) {
    const replace = vi.fn();
    const removeItem = vi.fn();
    runInNewContext(buildComposioCallbackInlineScript(), {
      URLSearchParams,
      window: {
        sessionStorage: {
          getItem: (key: string) => stored[key] ?? null,
          removeItem,
        },
        name: "",
        location: {
          origin: "https://app.sokosumi.com",
          search: `?session_uri=one-use&botId=${encodeURIComponent("attacker")}`,
          replace,
        },
      },
    });
    return { replace, removeItem };
  }

  it("forwards the bot id the tab remembered, and forgets it", () => {
    const { replace, removeItem } = runCallback({
      [COMPOSIO_BOT_ID_STORAGE_KEY]: BOT_ID,
    });
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      `/personal-assistant/integrations/verify?session_uri=one-use&botId=${BOT_ID}`,
    );
    expect(removeItem).toHaveBeenCalledWith(COMPOSIO_BOT_ID_STORAGE_KEY);
  });

  it("ignores a botId on Composio's query and verifies the caller's own bot", () => {
    const { replace } = runCallback({});
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/personal-assistant/integrations/verify?session_uri=one-use",
    );
  });

  it("remembers a shared bot and clears it for the caller's own bot", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
    try {
      rememberComposioBotId(BOT_ID);
      expect(store.get(COMPOSIO_BOT_ID_STORAGE_KEY)).toBe(BOT_ID);
      rememberComposioBotId(null);
      expect(store.has(COMPOSIO_BOT_ID_STORAGE_KEY)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
