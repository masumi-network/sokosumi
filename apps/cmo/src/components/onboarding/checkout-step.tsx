"use client";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { cmoMonthAtLevel, cmoVolumeLevelForTier } from "@sokosumi/utils";
import { ArrowRight, Loader2 } from "lucide-react";
import { type CSSProperties, useState, useTransition } from "react";
import { channelLabel } from "../../lib/calendar";
import { channelInfo, channelKey } from "../../lib/channels";
import { postsGoingOut } from "../../lib/strategy";
import { ChannelIcon } from "../channel-icon";
import { ShortLegalNotice } from "../legal-notice";
import { money } from "../strategy-core";
import { type SkipSubscription, SkipSubscriptionButton } from "../top-up";
import { CusoScene } from "./cuso-scene";
import type { CheckoutPhase } from "./step";

type Interval = CmoSubscriptionPlan["interval"];
type Strategy = NonNullable<CmoOverview["strategy"]>;

/** The networks CMO posts on, for a page without a strategy. */
const NETWORKS = [
  "x",
  "youtube",
  "instagram",
  "tiktok",
  "linkedin",
  "facebook",
];

/** What each plan posts, as the landing page says it, when there is no strategy yet. */
const PLAN_LINES = [
  "One post a day on each account you connect.",
  "Two posts a day on each account you connect.",
  "Up to three posts a day on each account you connect.",
];

/** The top plan's extra, as the landing page says it. */
const TEAM_CHECK = "Our team checks every post before it goes out.";

/**
 * How many posts a plan makes of this strategy a month, as they go out (a
 * short video is a post on each network): the month is written at the top
 * volume, and each plan makes its share of it (Core makes the same).
 */
function planPosts(strategy: Strategy, tier: string): number {
  const { made } = cmoMonthAtLevel(
    strategy.calendar,
    cmoVolumeLevelForTier(tier),
  );
  return postsGoingOut(strategy.calendar, made);
}

/** What a plan makes of the month, in one plain line. */
function postsLine(posts: number, most: number): string {
  if (posts >= most) return `All ${posts} posts a month`;
  const about = posts >= 20 ? Math.round(posts / 10) * 10 : posts;
  return `About ${about} posts a month`;
}

type Point = readonly [number, number];

/**
 * Each plan's rise, from the cheapest up, in a 64 by 40 box: gentle, steeper,
 * then a hockey stick that shoots out past the card's top line, into the gap
 * above it (no further: on a phone the plan above sits there).
 */
const RISES: readonly (readonly Point[])[] = [
  [
    [2, 32],
    [22, 27],
    [40, 23],
    [58, 15],
  ],
  [
    [2, 32],
    [20, 27],
    [36, 17],
    [58, 0],
  ],
  [
    [2, 34],
    [24, 32],
    [38, 28],
    [46, 17],
    [52, -14],
  ],
];

/** The rise as one unbroken stroke, the line then its arrowhead, so it draws in that order. */
function risePath(points: readonly Point[], head: number): string {
  const [x0, y0] = points[points.length - 2] ?? [0, 0];
  const [x, y] = points[points.length - 1] ?? [0, 0];
  const length = Math.hypot(x - x0, y - y0);
  const [ux, uy] = [(x - x0) / length, (y - y0) / length];
  const side = (sign: number) =>
    `${(x - head * ux + sign * head * 0.7 * uy).toFixed(1)} ${(y - head * uy - sign * head * 0.7 * ux).toFixed(1)}`;
  const line = points.map(([px, py]) => `${px} ${py}`).join(" L");
  return `M${line} L${side(1)} L${x} ${y} L${side(-1)}`;
}

/** A plan's chart arrow, steeper for each plan up; a picture, not read out. */
function PlanRise({ place }: { place: number }) {
  const top = Math.min(place, RISES.length - 1);
  const points = RISES[top] ?? [];
  const steep = top === RISES.length - 1;
  return (
    <svg
      className={steep ? "ob-plan-rise ob-plan-rise-steep" : "ob-plan-rise"}
      viewBox="0 0 64 40"
      aria-hidden="true"
      focusable="false"
      style={{ "--rise-delay": `${450 + top * 150}ms` } as CSSProperties}
    >
      <path d={risePath(points, steep ? 8 : 6)} pathLength={1} />
    </svg>
  );
}

/** A plan's price in its currency's main unit. */
function price(plan: CmoSubscriptionPlan, months = 1): string {
  return money(plan.priceAmount / 100 / months, plan.currency.toUpperCase());
}

/** The tier's slug is Polar's; only its first letter is ours. */
function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** What paying a year at once saves against twelve months, in whole percent. */
function yearlySaving(plans: CmoSubscriptionPlan[]): number {
  const savings = plans
    .filter((plan) => plan.interval === "year")
    .map((year) => {
      const month = plans.find(
        (plan) => plan.interval === "month" && plan.tier === year.tier,
      );
      return month ? 1 - year.priceAmount / (month.priceAmount * 12) : 0;
    });
  return Math.max(0, Math.round(Math.max(0, ...savings) * 100));
}

/** The networks the approved month posts on; ads are not a network here. */
function strategyNetworks(strategy: Strategy | null): string[] {
  const live = strategy?.calendar.filter((entry) => entry.status !== "skipped");
  if (!live?.length) return NETWORKS;
  return [
    ...new Set(
      live
        .filter((entry) => channelInfo(entry.channel)?.group !== "ads")
        .flatMap((entry) => [entry.channel, ...(entry.alsoOn ?? [])])
        .map((channel) => channelKey(channel) ?? channel),
    ),
  ];
}

interface CheckoutStepProps {
  /** The CMO plans as Core lists them; empty when they could not be read. */
  plans: CmoSubscriptionPlan[];
  phase: CheckoutPhase;
  /** The approved plan, to say what a subscription buys. */
  strategy?: Strategy | null;
  /** Starts Polar's checkout; the browser goes to the returned URL. */
  onCheckout: (
    interval: Interval,
    tier: string,
  ) => Promise<{ url: string | null; error: string | null }>;
  /** Back from the confirming state to the plans. */
  onShowPlans: () => void;
  /** Continues without a subscription, for a tester Core allows it. */
  skip?: SkipSubscription | null;
}

/**
 * Hiring's step after the approved plan (ADR 0068): the month's networks,
 * the CMO plans with the smallest one that makes all of it picked, then
 * Polar's hosted checkout. Back from Polar it waits for the payment's
 * confirmation; the accounts and Launch come next.
 */
export function CheckoutStep({
  plans,
  phase,
  strategy = null,
  onCheckout,
  onShowPlans,
  skip = null,
}: CheckoutStepProps) {
  // Yearly first, as it costs less a month; monthly is one tap away.
  const [interval, setInterval] = useState<Interval>(() =>
    plans.some((plan) => plan.interval === "year") ? "year" : "month",
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();

  if (phase === "confirming") {
    return (
      <section className="ob-checkout">
        <div className="ob-lead">
          <CusoScene scene="subscribe" now="Confirming your payment" />
          <h1 className="ob-h1">Almost there.</h1>
          <p className="ob-confirming muted" role="status">
            <Loader2 size={16} className="spin" aria-hidden="true" />
            Confirming your payment. Then you connect your accounts and I start.
          </p>
        </div>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={onShowPlans}
        >
          I haven't paid, show the plans
        </button>
      </section>
    );
  }

  const offered = plans
    .filter((plan) => plan.interval === interval)
    .sort((a, b) => a.priceAmount - b.priceAmount);
  const planned = strategy && strategy.calendar.length > 0 ? strategy : null;
  const makes = new Map(
    planned
      ? offered.map((plan) => [plan.tier, planPosts(planned, plan.tier)])
      : [],
  );
  const most = Math.max(0, ...makes.values());
  // The smallest plan that makes the whole strategy.
  const whole = planned
    ? offered.find((plan) => makes.get(plan.tier) === most)?.tier
    : undefined;
  // That plan until the person picks one; a pick carries over to the other
  // interval, which sells the same tiers.
  const tier =
    offered.find((plan) => plan.tier === picked)?.tier ??
    whole ??
    offered[0]?.tier;
  const chosen = offered.find((plan) => plan.tier === tier);
  const saving = yearlySaving(plans);
  const networks = strategyNetworks(strategy);
  const months = interval === "year" ? 12 : 1;

  function checkout(chosenTier: string) {
    setError(null);
    startOpening(async () => {
      try {
        const result = await onCheckout(interval, chosenTier);
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setError(result.error ?? "Could not open the checkout. Try again.");
      } catch {
        setError("Could not open the checkout. Try again.");
      }
    });
  }

  return (
    <section className="ob-checkout">
      <div className="ob-lead">
        <CusoScene scene="subscribe" />
        <h1 className="ob-h1">Your strategy is ready.</h1>
        <p className="muted">Pick a plan and I start right away.</p>
        <ul
          className="ob-networks-row"
          aria-label={`Posts on ${networks.map(channelLabel).join(", ")}`}
        >
          {networks.map((network) => (
            <li key={network} title={channelLabel(network)}>
              <ChannelIcon channel={network} size={22} />
            </li>
          ))}
        </ul>
      </div>

      {plans.length === 0 ? (
        <p className="alert" role="alert">
          Plans aren't available right now. Reload the page to try again.
        </p>
      ) : (
        <>
          <div className="ob-tabs ob-billing" role="group" aria-label="Billing">
            <button
              type="button"
              aria-pressed={interval === "month"}
              onClick={() => setInterval("month")}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={interval === "year"}
              onClick={() => setInterval("year")}
            >
              Yearly
              {saving > 0 ? (
                <span className="ob-save">Save {saving}%</span>
              ) : null}
            </button>
          </div>

          <div className="ob-plan-options" role="group" aria-label="Plan">
            {offered.map((plan, place) => {
              const monthly = plans.find(
                (other) =>
                  other.interval === "month" && other.tier === plan.tier,
              );
              const posts = makes.get(plan.tier);
              return (
                <button
                  key={plan.tier}
                  type="button"
                  aria-pressed={plan.tier === tier}
                  className="card ob-plan-option"
                  onClick={() => setPicked(plan.tier)}
                >
                  {plan.tier === whole && offered.length > 1 ? (
                    <span className="ob-plan-fit">Makes all of it</span>
                  ) : null}
                  <PlanRise place={place} />
                  <span className="ob-plan-name">{tierName(plan.tier)}</span>
                  {/* Both intervals fill the same lines, so switching never moves the cards. */}
                  {interval === "year" && monthly ? (
                    <s className="ob-small muted ob-swap">
                      {price(monthly)} a month
                    </s>
                  ) : (
                    <span className="ob-small" aria-hidden="true">
                      {"\u00a0"}
                    </span>
                  )}
                  <span key={interval} className="ob-value ob-swap">
                    {price(plan, months)}{" "}
                    <span className="ob-small muted">a month</span>
                  </span>
                  <span
                    key={`${interval}-billed`}
                    className="ob-small muted ob-swap"
                  >
                    {interval === "year"
                      ? `${price(plan)} billed yearly`
                      : "Billed monthly"}
                  </span>
                  {posts !== undefined ? (
                    <span className="ob-small">{postsLine(posts, most)}</span>
                  ) : PLAN_LINES[place] ? (
                    <span className="ob-small">{PLAN_LINES[place]}</span>
                  ) : null}
                  {place === PLAN_LINES.length - 1 ? (
                    <span className="ob-small">{TEAM_CHECK}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {error ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className="button ob-wide"
            disabled={opening || !tier}
            onClick={() => tier && checkout(tier)}
          >
            {opening
              ? "Opening checkout…"
              : chosen
                ? `Start ${tierName(chosen.tier)} for ${price(chosen, months)} a month`
                : "Continue to payment"}
            {opening ? null : <ArrowRight size={16} aria-hidden="true" />}
          </button>
          <ShortLegalNotice />
          {skip ? <SkipSubscriptionButton skip={skip} /> : null}
        </>
      )}
    </section>
  );
}
