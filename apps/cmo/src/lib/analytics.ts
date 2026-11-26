import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";

import { calendarIsExamples, strategyApproved } from "./strategy";

/** CMO.xyz's GA4 web stream, the same one www.cmo.xyz sends to. */
export const GA_MEASUREMENT_ID = "G-82QM6MPVWK";

/** Shared with www.cmo.xyz (cookie-consent.js): one choice for both hosts. */
export const CONSENT_COOKIE = "cmo_consent";

/** Where analytics waits for a yes: EU/EEA, the UK and Switzerland (apps/cmo-website/api/geo.js). */
const CONSENT_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "GF",
  "GP",
  "MQ",
  "RE",
  "YT",
  "MF",
  "AX",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
  "JE",
  "GG",
  "IM",
]); // prettier-ignore

export type AnalyticsConsent = "granted" | "denied" | "ask";

/** The `_ga_<stream>` cookie: its session id says which visit a checkout was in. */
export const GA_SESSION_COOKIE = `_ga_${GA_MEASUREMENT_ID.slice(2)}`;

/**
 * GA4's client id from `_ga` (GA1.1.<id>.<time>) and session id from the
 * stream cookie, in its old (GS1.1.<session>.…) or new (GS2.1.s<session>$…)
 * form; null without a client id.
 */
export function gaIds(
  gaCookie: string | undefined,
  sessionCookie: string | undefined,
): { clientId: string; sessionId?: string } | null {
  const client = /^GA\d\.\d\.(\d+\.\d+)$/.exec(gaCookie ?? "")?.[1];
  if (!client) return null;
  const session =
    /^GS2\.\d\.s(\d+)/.exec(sessionCookie ?? "")?.[1] ??
    /^GS1\.\d\.(\d+)\./.exec(sessionCookie ?? "")?.[1];
  return session
    ? { clientId: client, sessionId: session }
    : { clientId: client };
}

/** The saved choice wins; without one, consent countries (and unknown ones) ask. */
export function analyticsConsent(
  saved: string | undefined,
  country: string | null,
): AnalyticsConsent {
  if (saved === "granted" || saved === "denied") return saved;
  const code = (country ?? "").toUpperCase();
  return !code || CONSENT_COUNTRIES.has(code) ? "ask" : "granted";
}

type Params = Record<string, unknown>;
export type AnalyticsEvent = [name: string, params: Params];

type Gtag = (...args: unknown[]) => void;
type AnalyticsGlobal = { gtag?: Gtag; cmoAnalyticsQueue?: unknown[][] };

/**
 * Calls gtag, or holds the call until the tag loads (`flushAnalytics`): a
 * page's own effects run before the consent check loads the tag. Without
 * consent the tag never loads and nothing held is sent.
 */
function gtagCall(...args: unknown[]): void {
  const global = globalThis as AnalyticsGlobal;
  if (typeof global.gtag === "function") {
    global.gtag(...args);
    return;
  }
  global.cmoAnalyticsQueue ??= [];
  if (global.cmoAnalyticsQueue.length < 100)
    global.cmoAnalyticsQueue.push(args);
}

/** Sends the calls held before the tag loaded. */
export function flushAnalytics(): void {
  const global = globalThis as AnalyticsGlobal;
  const held = global.cmoAnalyticsQueue ?? [];
  global.cmoAnalyticsQueue = [];
  for (const args of held) global.gtag?.(...args);
}

export function track(name: string, params: Params = {}): void {
  gtagCall("event", name, params);
}

export function setUserProperties(properties: Params): void {
  gtagCall("set", "user_properties", properties);
}

/** A plan as a GA4 item: id the tier, variant the billing period, price in dollars. */
export function planItem(plan: CmoSubscriptionPlan, index?: number): Params {
  return {
    item_id: plan.tier,
    item_name: plan.name,
    item_category: "plan",
    item_variant: plan.interval,
    price: plan.priceAmount / 100,
    ...(index === undefined ? {} : { index }),
  };
}

export function beginCheckout(plan: CmoSubscriptionPlan): AnalyticsEvent {
  return [
    "begin_checkout",
    {
      currency: plan.currency.toUpperCase(),
      value: plan.priceAmount / 100,
      plan: plan.tier,
      billing_period: plan.interval,
      items: [planItem(plan)],
    },
  ];
}

export function viewPlans(
  plans: CmoSubscriptionPlan[],
  interval: CmoSubscriptionPlan["interval"],
): AnalyticsEvent {
  return [
    "view_item_list",
    {
      item_list_id: `plans_${interval}`,
      item_list_name: "Subscribe",
      items: plans
        .filter((plan) => plan.interval === interval)
        .map((plan, index) => planItem(plan, index)),
    },
  ];
}

/**
 * What a Cuso has reached, as GA4 events keyed so each fires once per Cuso.
 * The overview is the source of truth, so a step reached in another tab or
 * while the page was closed still counts the next time it is seen.
 */
export function milestones(
  overview: CmoOverview,
): Array<{ key: string; event: AnalyticsEvent }> {
  const reached: Array<{ key: string; event: AnalyticsEvent }> = [];
  const add = (key: string, name: string, params: Params = {}) =>
    reached.push({ key, event: [name, params] });
  add("research_start", "research_start");
  if (overview.brandBrain) add("research_done", "research_done");
  if (overview.brandBrainConfirmedAt) add("brand_confirmed", "brand_confirmed");
  const strategy = overview.strategy;
  if (strategy && strategy.calendar.length > 0) {
    const examples = calendarIsExamples(strategy);
    add("strategy_ready", "strategy_ready", { examples });
    if (examples) {
      add("examples_shown", "examples_shown", {
        pieces: strategy.calendar.length,
      });
    }
  }
  if (strategyApproved(overview)) add("strategy_approved", "strategy_approved");
  if (overview.onboardingStep === "done")
    add("onboarding_done", "onboarding_done");
  if (overview.production.state === "ready" || overview.production.finishedAt) {
    add("month_written", "month_written", {
      pieces: overview.production.total,
    });
  }
  for (const channel of overview.channels) {
    if (channel.status.toUpperCase() !== "ACTIVE") continue;
    add(`channel:${channel.provider}`, "channel_connected", {
      network: channel.provider,
    });
  }
  for (const source of overview.measurement) {
    if (source.status !== "connected") continue;
    add(`measure:${source.provider}`, "channel_connected", {
      network: source.provider,
    });
  }
  if (overview.upgrade) {
    add(`upgrade:${overview.upgrade.versionId}`, "upgrade_dialog_view", {
      cmo_version: overview.upgrade.versionId,
    });
  }
  return reached;
}

/** The user properties GA4 segments by; null where there is no plan. */
export function userProperties(overview: CmoOverview): Params {
  return {
    plan: overview.billing.tier ?? "none",
    billing_period: overview.billing.interval ?? "none",
    onboarding_step: overview.onboardingStep,
  };
}

/** sign_up for an account made in the last fifteen minutes, login otherwise. */
export function authEvent(
  createdAt: Date,
  now = Date.now(),
): "sign_up" | "login" {
  return now - createdAt.getTime() < 15 * 60 * 1000 ? "sign_up" : "login";
}

type Action = (...args: unknown[]) => Promise<unknown>;

/** What an action's success sends, from its arguments and result; null sends nothing. */
export type ToEvent = (
  args: unknown[],
  result: unknown,
) => AnalyticsEvent | null;

/** The actions, each sending its event after it succeeds; failures send nothing. */
export function withEvents<T extends object>(
  actions: T,
  events: Record<string, ToEvent>,
  send: (event: AnalyticsEvent) => void = (event) => track(...event),
): T {
  const wrapped: Record<string, unknown> = {
    ...(actions as Record<string, unknown>),
  };
  for (const [name, toEvent] of Object.entries(events)) {
    const action = (actions as Record<string, Action | undefined>)[name];
    if (!action) continue;
    wrapped[name] = async (...args: unknown[]) => {
      const result = await action(...args);
      const event = toEvent(args, result);
      if (event) send(event);
      return result;
    };
  }
  return wrapped as T;
}

const ok = (result: unknown): boolean =>
  !(result && typeof result === "object" && "error" in result && result.error);

/** A connect action's first argument names the network, when it is a string. */
const network = (args: unknown[]): Params =>
  typeof args[0] === "string" ? { network: args[0] } : {};

/** Events shared by the first run and the app. */
export function commonEvents(surface: "onboarding" | "app") {
  return {
    sendMessage: (): AnalyticsEvent => ["chat_message_sent", { surface }],
    requestStrategy: (_: unknown[], result: unknown): AnalyticsEvent | null =>
      ok(result) ? ["strategy_change_requested", { surface }] : null,
    connectChannel: (args: unknown[]): AnalyticsEvent => [
      "channel_connect_start",
      { surface, ...network(args) },
    ],
    connectAds: (args: unknown[]): AnalyticsEvent => [
      "channel_connect_start",
      { surface, ...network(args) },
    ],
    connectMeasurement: (args: unknown[]): AnalyticsEvent => [
      "channel_connect_start",
      { surface, ...network(args) },
    ],
    startTopUp: (_: unknown[], result: unknown): AnalyticsEvent | null =>
      ok(result) ? ["top_up_start", { surface }] : null,
  };
}

/** Events only the app sends; drafts name their network from the overview. */
export function appEvents(overview: () => CmoOverview) {
  const draftNetwork = (args: unknown[]): Params => {
    const draft = overview().drafts.find(
      (candidate) => candidate.id === args[0],
    );
    return draft ? { network: draft.provider } : {};
  };
  const draft =
    (name: string) =>
    (args: unknown[], result: unknown): AnalyticsEvent | null =>
      ok(result) ? [name, draftNetwork(args)] : null;
  return {
    ...commonEvents("app"),
    approveDraft: draft("post_approved"),
    declineDraft: draft("post_declined"),
    editDraft: draft("post_edited"),
    changePlan: (args: unknown[], result: unknown): AnalyticsEvent | null => {
      const change = (result as { change?: string | null }).change;
      return ok(result) && change && change !== "kept"
        ? ["plan_change", { plan: String(args[0]), change }]
        : null;
    },
    openPortal: (_: unknown[], result: unknown): AnalyticsEvent | null =>
      ok(result) ? ["manage_billing_open", {}] : null,
    subscribe: (_: unknown[], result: unknown): AnalyticsEvent | null =>
      ok(result) ? ["begin_checkout", { surface: "app" }] : null,
  };
}
