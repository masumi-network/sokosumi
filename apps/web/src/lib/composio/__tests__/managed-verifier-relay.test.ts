import { runInNewContext } from "node:vm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildComposioCallbackInlineScript,
  buildComposioHandoffInlineScript,
  COMPOSIO_BOT_ID_STORAGE_KEY,
  COMPOSIO_HANDOFF_STORAGE_KEY,
  COMPOSIO_OAUTH_BROADCAST_CHANNEL,
  COMPOSIO_OAUTH_NONCE_STORAGE_KEY,
  getComposioOAuthPopupName,
} from "@/lib/composio/oauth-popup-protocol";
import { proxy } from "@/proxy";

const boundary = vi.hoisted(() => ({ cookie: vi.fn(), env: vi.fn() }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: boundary.cookie }));
vi.mock("@/config/env.secrets", () => ({ getEnvSecrets: boundary.env }));

const CANONICAL_ORIGIN = "https://preprod.sokosumi.com";
const FEATURE_ORIGIN =
  "https://sokosumi-app-preprod-git-feat-seo-workspace.preview.sokosumi.com";
const VERIFIER_PATH = "/personal-assistant/integrations/verify";
// Fixed wire contract. The pre-change source has no marker export to import.
const OWNER_REENTRY_PARAM = "__sokosumi_owner_verification";
const NOW = Date.parse("2026-11-06T12:00:00Z");
const HANDOFF_TTL_MS = 15 * 60_000;
const REMOTE_NONCE = "01a1b00d-bff3-778d-b556-d0e28af1796c";
const LOCAL_NONCE = "01a1b00d-bff3-778d-b556-d0e28af1796d";
const AUDIT_ID = "01a1b00d-bff3-778d-b556-d0e28af1796e";
const SHARED_BOT_ID = "01a1b00d-bff3-778d-b556-d0e28af1796f";
const SESSION_URI = "https://backend.composio.dev/session/one-use-proof";
const CONNECTION_ID = "ca_seo_owner";
const nativeReturn = new URL("/seo/connections/callback", FEATURE_ORIGIN);
nativeReturn.search = new URLSearchParams({
  provider: "ga4",
  viewer: "alice",
  organization: "organization-a",
  seo_state: REMOTE_NONCE,
  auditId: AUDIT_ID,
}).toString();

function browser(name = "", origin = CANONICAL_ORIGIN) {
  const stored = new Map<string, string>();
  const redirected: URL[] = [];
  const broadcast: Array<{ channel: string; payload: unknown }> = [];
  const close = vi.fn();
  const openerMessage = vi.fn();
  const location = {
    origin,
    hostname: new URL(origin).hostname,
    pathname: VERIFIER_PATH,
    search: `?${new URLSearchParams({ session_uri: SESSION_URI })}`,
    replace: vi.fn((value: string) => redirected.push(new URL(value, origin))),
  };
  class Channel {
    constructor(readonly channel: string) {}
    postMessage(payload: unknown) {
      broadcast.push({ channel: this.channel, payload });
    }
    close() {}
  }
  const window = {
    name,
    location,
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
    opener: { postMessage: openerMessage },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    close,
  };
  function run(script: string) {
    runInNewContext(script, {
      window,
      URL,
      URLSearchParams,
      BroadcastChannel: Channel,
      setTimeout: vi.fn(),
      Date: class extends Date {
        static now() {
          return NOW;
        }
      },
    });
  }
  function handoff(returnUrl = nativeReturn) {
    run(
      buildComposioHandoffInlineScript({
        to: "https://connect.composio.dev/link/native-seo",
        returnUrl: returnUrl.toString(),
        connectionId: CONNECTION_ID,
      }),
    );
    redirected.length = 0;
    location.replace.mockClear();
  }
  return {
    window,
    stored,
    redirected,
    broadcast,
    close,
    openerMessage,
    handoff,
    callback: () => run(buildComposioCallbackInlineScript()),
  };
}

/** The session left for no page but this host's own signed-in check. */
function expectSessionKept(flow: ReturnType<typeof browser>) {
  expect(flow.redirected).toHaveLength(1);
  const target = flow.redirected[0];
  expect(target.origin + target.pathname).toBe(
    flow.window.location.origin + VERIFIER_PATH,
  );
  expect(target.searchParams.getAll(OWNER_REENTRY_PARAM)).toEqual(["1"]);
  expect(flow.broadcast).toEqual([]);
  expect(flow.openerMessage).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.cookie.mockReturnValue("owner-session");
  boundary.env.mockReturnValue({
    MAINTENANCE_MODE: false,
    NETWORK: "Preprod",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "preprod",
    VERCEL_URL: CANONICAL_ORIGIN,
  });
});

describe("managed verifier cross-protocol relay", () => {
  it.each([FEATURE_ORIGIN, CANONICAL_ORIGIN])(
    "returns a native SEO handoff to its %s callback before notifying the opener",
    (origin) => {
      const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
      const returnUrl = new URL(
        nativeReturn.pathname + nativeReturn.search,
        origin,
      );
      flow.stored.set(COMPOSIO_OAUTH_NONCE_STORAGE_KEY, REMOTE_NONCE);
      flow.handoff(returnUrl);
      flow.callback();
      expect(flow.redirected).toHaveLength(1);
      const target = flow.redirected[0];
      expect(target.origin + target.pathname).toBe(
        origin + "/seo/connections/callback",
      );
      expect(target.searchParams.get("session_uri")).toBe(SESSION_URI);
      expect(target.searchParams.get("connected_account_id")).toBe(
        CONNECTION_ID,
      );
      expect(target.searchParams.get("seo_state")).toBe(REMOTE_NONCE);
      expect(flow.broadcast).toEqual([]);
      expect(flow.openerMessage).not.toHaveBeenCalled();
      expect(flow.close).not.toHaveBeenCalled();
      expect(flow.stored.has(COMPOSIO_HANDOFF_STORAGE_KEY)).toBe(false);
    },
  );

  // The rule does not depend on the page the script runs at: Composio's fixed
  // return page is a setting of the Composio project.
  describe("where a session may go", () => {
    it.each([
      ["a different page of the preview", `${FEATURE_ORIGIN}/seo`],
      [
        "a page below the redeeming page",
        `${FEATURE_ORIGIN}/seo/connections/callback/x`,
      ],
      ["the popup page of the preview", `${FEATURE_ORIGIN}/composio/callback`],
      ["a share page of this host", `${CANONICAL_ORIGIN}/share/abc`],
      [
        "the redeeming path on a docs host",
        "https://docs.sokosumi.com/seo/connections/callback",
      ],
      [
        "the redeeming path on the Mainnet host",
        "https://app.sokosumi.com/seo/connections/callback",
      ],
      [
        "the redeeming path on a Core preview",
        "https://sokosumi-core-preprod-git-x.preview.sokosumi.com/seo/connections/callback",
      ],
      [
        "the redeeming path on a Mainnet preview",
        "https://sokosumi-app-mainnet-git-x.preview.sokosumi.com/seo/connections/callback",
      ],
      [
        "the redeeming path below a preview host name",
        "https://x.sokosumi-app-preprod-git-a.preview.sokosumi.com/seo/connections/callback",
      ],
      [
        "a host that only starts like a preview",
        "https://sokosumi-app-preprod-git-a.preview.sokosumi.com.sokosumi.com/seo/connections/callback",
      ],
      [
        "a different port of a preview",
        `${FEATURE_ORIGIN}:8443/seo/connections/callback`,
      ],
    ])("keeps a session away from %s", (_name, returnUrl) => {
      const flow = browser();
      flow.handoff(new URL(returnUrl));
      flow.callback();
      expectSessionKept(flow);
    });

    it("returns a session to a preview from the Preprod host only", () => {
      const flow = browser("", "https://app.sokosumi.com");
      flow.handoff();
      flow.callback();
      expectSessionKept(flow);
    });

    it("returns a session from one preview to no second preview", () => {
      const flow = browser("", FEATURE_ORIGIN);
      flow.handoff(
        new URL(
          "https://sokosumi-app-preprod-git-other.preview.sokosumi.com/seo/connections/callback",
        ),
      );
      flow.callback();
      expectSessionKept(flow);
    });

    it("returns a session to the redeeming page of its own host on Mainnet", () => {
      const origin = "https://app.sokosumi.com";
      const flow = browser("", origin);
      flow.handoff(
        new URL(nativeReturn.pathname + nativeReturn.search, origin),
      );
      flow.callback();
      expect(flow.redirected).toHaveLength(1);
      expect(flow.redirected[0].origin + flow.redirected[0].pathname).toBe(
        `${origin}/seo/connections/callback`,
      );
      expect(flow.redirected[0].searchParams.get("session_uri")).toBe(
        SESSION_URI,
      );
    });

    it("keeps a refused session on this host when the popup has a name", () => {
      const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
      flow.handoff(new URL(`${FEATURE_ORIGIN}/seo`));
      flow.callback();
      expect(flow.redirected).toEqual([]);
      expect(flow.broadcast.map((sent) => sent.channel)).toEqual([
        `${COMPOSIO_OAUTH_BROADCAST_CHANNEL}:${REMOTE_NONCE}`,
      ]);
      expect(flow.openerMessage).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        CANONICAL_ORIGIN,
      );
    });

    it("leaves a return to a different first-party app as it was", () => {
      const flow = browser();
      flow.handoff(
        new URL(
          "https://app.cmo.xyz/measure/callback?provider=google_analytics",
        ),
      );
      flow.callback();
      expect(flow.redirected.map(String)).toEqual([
        `https://app.cmo.xyz/measure/callback?provider=google_analytics&session_uri=${encodeURIComponent(SESSION_URI)}&connected_account_id=${CONNECTION_ID}`,
      ]);
    });
  });

  it("clears an inherited canonical nonce when a different first-party app starts its handoff", () => {
    const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
    flow.stored.set(COMPOSIO_OAUTH_NONCE_STORAGE_KEY, LOCAL_NONCE);
    flow.handoff();
    expect(flow.stored.has(COMPOSIO_OAUTH_NONCE_STORAGE_KEY)).toBe(false);
    expect(
      JSON.parse(flow.stored.get(COMPOSIO_HANDOFF_STORAGE_KEY) ?? "null"),
    ).toMatchObject({ popupNonce: REMOTE_NONCE });
  });

  it("gives a current same-origin stored nonce precedence over an older cross-app handoff", () => {
    const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
    flow.handoff();
    flow.stored.set(COMPOSIO_OAUTH_NONCE_STORAGE_KEY, LOCAL_NONCE);
    flow.callback();
    expect(flow.redirected).toEqual([]);
    expect(flow.broadcast).toEqual([
      {
        channel: `${COMPOSIO_OAUTH_BROADCAST_CHANNEL}:${LOCAL_NONCE}`,
        payload: expect.objectContaining({
          nonce: LOCAL_NONCE,
          sessionUri: SESSION_URI,
        }),
      },
    ]);
    expect(flow.close).toHaveBeenCalledOnce();
  });

  it("preserves the initiating SEO actor, provider and Audit while copying only provider results", () => {
    const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
    flow.handoff();
    flow.window.name = "";
    flow.window.location.search = `?${new URLSearchParams({ session_uri: SESSION_URI, status: "success", viewer: "mallory", organization: "foreign-org", provider: "search_console", seo_state: LOCAL_NONCE, auditId: SHARED_BOT_ID, returnUrl: "https://attacker.invalid/", botId: "attacker", userId: "attacker" })}`;
    flow.callback();
    expect(flow.redirected).toHaveLength(1);
    const target = flow.redirected[0];
    for (const [key, value] of nativeReturn.searchParams)
      expect(target.searchParams.get(key)).toBe(value);
    expect(target.searchParams.get("session_uri")).toBe(SESSION_URI);
    expect(target.searchParams.get("status")).toBe("success");
    expect(target.searchParams.get("connected_account_id")).toBe(CONNECTION_ID);
    for (const key of ["returnUrl", "botId", "userId"])
      expect(target.searchParams.has(key)).toBe(false);
  });

  it("does not give the native handoff credentials for a substituted connected account", () => {
    const flow = browser();
    flow.handoff();
    flow.window.location.search = `?${new URLSearchParams({ session_uri: SESSION_URI, connected_account_id: "ca_other_owner" })}`;
    flow.callback();
    // The page that started the connect learns of the failure, with no session.
    expect(flow.redirected).toHaveLength(1);
    const target = flow.redirected[0];
    expect(target.origin + target.pathname).toBe(
      FEATURE_ORIGIN + "/seo/connections/callback",
    );
    expect(target.searchParams.has("session_uri")).toBe(false);
    expect(target.searchParams.get("status")).toBe("error");
    expect(target.searchParams.get("error")).toBe("connection_mismatch");
    expect(target.searchParams.get("connected_account_id")).toBe(CONNECTION_ID);
    expect(flow.broadcast).toEqual([]);
    expect(flow.openerMessage).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "expired",
      record: {
        returnUrl: nativeReturn.toString(),
        connectionId: CONNECTION_ID,
        at: NOW - HANDOFF_TTL_MS,
      },
    },
    {
      name: "future timestamp",
      record: {
        returnUrl: nativeReturn.toString(),
        connectionId: CONNECTION_ID,
        at: NOW + 1_000,
      },
    },
    { name: "malformed JSON", raw: "{" },
    {
      name: "malformed timestamp",
      record: {
        returnUrl: nativeReturn.toString(),
        connectionId: CONNECTION_ID,
        at: "not-a-time",
      },
    },
    {
      name: "foreign host",
      record: {
        returnUrl: "https://attacker.invalid/callback",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "foreign suffix",
      record: {
        returnUrl: "https://app.sokosumi.com.attacker.invalid/callback",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "host disguised as user info",
      record: {
        returnUrl: "https://app.sokosumi.com@attacker.invalid/callback",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "insecure first-party URL",
      record: {
        returnUrl: "http://app.sokosumi.com/callback",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "first-party URL with user info",
      record: {
        returnUrl: "https://user@app.cmo.xyz/connect/callback",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "first-party URL with a fragment",
      record: {
        returnUrl: "https://app.cmo.xyz/connect/callback#fragment",
        connectionId: CONNECTION_ID,
        at: NOW,
      },
    },
    {
      name: "empty connection",
      record: {
        returnUrl: "https://app.cmo.xyz/connect/callback",
        connectionId: "",
        at: NOW,
      },
    },
  ])("does not send credentials to a $name handoff", ({ record, raw }) => {
    const flow = browser();
    flow.stored.set(
      COMPOSIO_HANDOFF_STORAGE_KEY,
      raw ?? JSON.stringify(record),
    );
    flow.callback();
    expectSessionKept(flow);
  });

  it("rejects a handoff from another popup attempt while preserving the surviving local popup fallback", () => {
    const flow = browser(getComposioOAuthPopupName(REMOTE_NONCE));
    flow.handoff();
    flow.window.name = getComposioOAuthPopupName(LOCAL_NONCE);
    flow.callback();
    expect(flow.redirected).toEqual([]);
    expect(flow.broadcast).toEqual([
      {
        channel: `${COMPOSIO_OAUTH_BROADCAST_CHANNEL}:${LOCAL_NONCE}`,
        payload: expect.objectContaining({
          nonce: LOCAL_NONCE,
          sessionUri: SESSION_URI,
        }),
      },
    ]);
  });

  it.each([null, SHARED_BOT_ID])(
    "reenters the authenticated owner verifier once, using only remembered bot %s",
    async (botId) => {
      const flow = browser();
      if (botId) flow.stored.set(COMPOSIO_BOT_ID_STORAGE_KEY, botId);
      flow.window.location.search +=
        "&botId=attacker&userId=attacker&returnUrl=https%3A%2F%2Fattacker.invalid";
      flow.callback();
      expect(flow.redirected).toHaveLength(1);
      const target = flow.redirected[0];
      expect(target.origin + target.pathname).toBe(
        CANONICAL_ORIGIN + VERIFIER_PATH,
      );
      expect(target.searchParams.getAll(OWNER_REENTRY_PARAM)).toEqual(["1"]);
      expect(target.searchParams.get("session_uri")).toBe(SESSION_URI);
      expect(target.searchParams.get("botId")).toBe(botId);
      expect(target.searchParams.has("userId")).toBe(false);
      expect(target.searchParams.has("returnUrl")).toBe(false);
      expect(flow.stored.has(COMPOSIO_BOT_ID_STORAGE_KEY)).toBe(false);
      expect(flow.broadcast).toEqual([]);
      expect(flow.close).not.toHaveBeenCalled();
      const response = await proxy(new NextRequest(target));
      expect(boundary.cookie).toHaveBeenCalledOnce();
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );
});
