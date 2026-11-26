import { describe, expect, it, vi } from "vitest";
import { cmoBilling, cmoOverview, cmoPlans } from "../test-fixtures/cmo";
import { brain, draft, reading } from "../test-fixtures/onboarding";
import {
  analyticsConsent,
  appEvents,
  authEvent,
  beginCheckout,
  commonEvents,
  gaIds,
  milestones,
  userProperties,
  viewPlans,
  withEvents,
} from "./analytics";

const hiring = { onboardingStep: "strategy" as const, measurement: [] };
const keys = (overview: Parameters<typeof milestones>[0]) =>
  milestones({ ...overview, ...hiring }).map(({ key }) => key);

describe("analyticsConsent", () => {
  it("keeps a saved choice and asks only where consent is required", () => {
    expect(analyticsConsent("granted", "DE")).toBe("granted");
    expect(analyticsConsent("denied", "US")).toBe("denied");
    expect(analyticsConsent(undefined, "de")).toBe("ask");
    expect(analyticsConsent(undefined, "CH")).toBe("ask");
    expect(analyticsConsent(undefined, null)).toBe("ask");
    expect(analyticsConsent(undefined, "US")).toBe("granted");
    expect(analyticsConsent("junk", "US")).toBe("granted");
  });
});

describe("milestones", () => {
  it("follows hiring from the read to an approved strategy", () => {
    expect(keys(reading())).toEqual(["research_start"]);
    expect(keys(cmoOverview({ brandBrain: brain, strategy: null }))).toEqual([
      "research_start",
      "research_done",
    ]);
    expect(keys(draft())).toEqual([
      "research_start",
      "research_done",
      "brand_confirmed",
      "strategy_ready",
    ]);
  });

  it("names connected networks and never sends their handles", () => {
    const overview = draft({
      channels: [
        {
          id: "c1",
          provider: "x",
          handle: "@acme",
          displayName: "Acme",
          status: "ACTIVE",
          personalProfile: false,
        },
        {
          id: "c2",
          provider: "linkedin",
          handle: null,
          displayName: null,
          status: "EXPIRED",
          personalProfile: false,
        },
      ],
    });
    const connected = milestones(overview).filter(({ key }) =>
      key.startsWith("channel:"),
    );
    expect(connected).toEqual([
      { key: "channel:x", event: ["channel_connected", { network: "x" }] },
    ]);
    expect(JSON.stringify(milestones(overview))).not.toContain("@acme");
  });
});

describe("plans", () => {
  it("lists one interval's plans and checks out in dollars", () => {
    const [name, params] = viewPlans(cmoPlans, "year");
    expect(name).toBe("view_item_list");
    expect(params.items).toEqual([
      expect.objectContaining({
        item_id: "starter",
        item_variant: "year",
        price: 2000,
        index: 0,
      }),
      expect.objectContaining({ item_id: "growth", price: 5000, index: 1 }),
      expect.objectContaining({ item_id: "scale", price: 10000, index: 2 }),
    ]);
    expect(beginCheckout(cmoPlans[1])).toEqual([
      "begin_checkout",
      {
        currency: "USD",
        value: 500,
        plan: "growth",
        billing_period: "month",
        items: [expect.objectContaining({ item_id: "growth", price: 500 })],
      },
    ]);
  });

  it("reads plan and billing period as user properties", () => {
    expect(
      userProperties(
        cmoOverview({
          billing: cmoBilling({ tier: "Growth", interval: "year" }),
        }),
      ),
    ).toMatchObject({
      plan: "Growth",
      billing_period: "year",
    });
    expect(userProperties(cmoOverview())).toMatchObject({
      plan: "none",
      billing_period: "none",
    });
  });
});

describe("withEvents", () => {
  it("sends an event after success only, never the message text", async () => {
    const send = vi.fn();
    const actions = withEvents(
      {
        sendMessage: async (_text: string) => undefined,
        startTopUp: async () => ({ url: null, error: "No" }),
        loadState: async () => "state",
      },
      commonEvents("app"),
      send,
    );
    await actions.sendMessage("our secret launch");
    await actions.startTopUp();
    expect(await actions.loadState()).toBe("state");
    expect(send.mock.calls).toEqual([
      [["chat_message_sent", { surface: "app" }]],
    ]);
  });

  it("sends nothing when the action throws", async () => {
    const send = vi.fn();
    const actions = withEvents(
      { sendMessage: async () => Promise.reject(new Error("down")) },
      commonEvents("onboarding"),
      send,
    );
    await expect(actions.sendMessage()).rejects.toThrow("down");
    expect(send).not.toHaveBeenCalled();
  });

  it("names the network of an approved post and a real plan change", async () => {
    const overview = cmoOverview({
      drafts: [
        {
          ...cmoOverview().drafts[0],
          id: "p1",
          provider: "instagram",
        } as never,
      ],
    });
    const send = vi.fn();
    const actions = withEvents(
      {
        approveDraft: async (_id: string) => ({ overview: null, error: null }),
        changePlan: async (_tier: string) => ({
          change: "kept" as const,
          error: null,
        }),
      },
      appEvents(() => overview),
      send,
    );
    await actions.approveDraft("p1");
    await actions.changePlan("Scale");
    expect(send.mock.calls).toEqual([
      [["post_approved", { network: "instagram" }]],
    ]);
  });
});

describe("authEvent", () => {
  it("is sign_up for an account made in the last fifteen minutes", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    expect(authEvent(new Date("2026-11-25T11:50:00Z"), now)).toBe("sign_up");
    expect(authEvent(new Date("2026-11-25T11:00:00Z"), now)).toBe("login");
  });
});

describe("gaIds", () => {
  it("reads the client id and either form of the session cookie", () => {
    expect(
      gaIds(
        "GA1.1.123456789.1764000000",
        "GS2.1.s1764070000$o3$g1$t1764070100$j60$l0$h0",
      ),
    ).toEqual({
      clientId: "123456789.1764000000",
      sessionId: "1764070000",
    });
    expect(
      gaIds("GA1.1.123.456", "GS1.1.1764070000.3.1.1764070100.0.0.0"),
    ).toEqual({
      clientId: "123.456",
      sessionId: "1764070000",
    });
    expect(gaIds("GA1.1.123.456", undefined)).toEqual({ clientId: "123.456" });
    expect(gaIds(undefined, "GS2.1.s1")).toBeNull();
    expect(gaIds("junk", undefined)).toBeNull();
  });
});
