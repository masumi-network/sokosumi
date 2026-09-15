import { describe, expect, it } from "vitest";

import {
  buildComposioCallbackInlineScript,
  COMPOSIO_OAUTH_ACK_TYPE,
  COMPOSIO_OAUTH_BROADCAST_CHANNEL,
  COMPOSIO_OAUTH_MESSAGE_TYPE,
  isComposioOAuthAckPayload,
  isComposioOAuthCallbackPayload,
  parseComposioCallbackSearchParams,
  readPopupClosed,
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

  it("reads popup.closed when the browser allows it", () => {
    const popup = { closed: false } as Window;
    expect(readPopupClosed(popup)).toBe(false);
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
