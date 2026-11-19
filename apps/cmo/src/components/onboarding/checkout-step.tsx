"use client";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { cmoMonthAtLevel, cmoVolumeLevelForTier } from "@sokosumi/utils";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { AGENT_NAME } from "../../lib/agent";
import { channelLabel } from "../../lib/calendar";
import { channelKey, formatMedia } from "../../lib/channels";
import { joinNames } from "../../lib/names";
import { money, PACES } from "../strategy-core";
import { type SkipSubscription, SkipSubscriptionButton } from "../top-up";
import { CusoScene } from "./cuso-scene";
import type { CheckoutPhase } from "./step";

type Interval = CmoSubscriptionPlan["interval"];
type Strategy = NonNullable<CmoOverview["strategy"]>;
type Pace = NonNullable<Strategy["pace"]>["level"];

/** The plan each pace fits, by its place among the plans from cheapest up. */
const PACE_PLAN: Record<Pace, number> = { steady: 0, active: 1, all_in: 2 };

/**
 * What a plan makes of this strategy a month: the month is written at the
 * top volume, and each plan makes its share of it (Core makes the same).
 */
function planMakes(strategy: Strategy, tier: string) {
  return cmoMonthAtLevel(
    strategy.calendar,
    strategy.channels,
    cmoVolumeLevelForTier(tier),
  );
}

function makesLine({
  posts,
  pictures,
  videos,
}: ReturnType<typeof planMakes>): string {
  const counted = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  return `${counted(posts, "post", "posts")}, ${counted(pictures, "picture", "pictures")} and ${counted(videos, "video", "videos")} a month from your strategy`;
}

/** What each plan posts, as the landing page says it, when there is no strategy yet. */
const PLAN_LINES = [
  "One post a day on each account you connect.",
  "Two posts a day on each account you connect.",
  "Up to three posts a day on each account you connect.",
];

/** The top plan's extra, as the landing page says it. */
const TEAM_CHECK =
  "Plus: our team checks every post for you before it goes out.";

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

/** What the approved plan makes in a month, in the person's terms. */
function monthOf(strategy: Strategy) {
  const media = strategy.calendar.map((entry) =>
    formatMedia(entry.channel, entry.format),
  );
  const channels = [
    ...new Set(
      strategy.calendar.map(
        (entry) => channelKey(entry.channel) ?? entry.channel,
      ),
    ),
  ].map(channelLabel);
  return {
    pieces: strategy.calendar.length,
    channels,
    pictures: media.filter((kind) => kind === "image" || kind === "images")
      .length,
    videos: media.filter((kind) => kind === "video").length,
  };
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
 * Hiring's step after the approved plan (ADR 0068): what the month holds,
 * the CMO plans with the one that fits its pace picked, then Polar's hosted
 * checkout. Back from Polar it waits for the payment's confirmation; the
 * accounts and Launch come next.
 */
export function CheckoutStep({
  plans,
  phase,
  strategy = null,
  onCheckout,
  onShowPlans,
  skip = null,
}: CheckoutStepProps) {
  const [interval, setInterval] = useState<Interval>("month");
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
  const pace = strategy?.pace?.level;
  const makes = new Map(
    strategy
      ? offered.map((plan) => [plan.tier, planMakes(strategy, plan.tier)])
      : [],
  );
  const most = Math.max(0, ...[...makes.values()].map((made) => made.posts));
  // The smallest plan that makes the whole strategy; without one, the pace's.
  const whole = strategy
    ? offered.find((plan) => makes.get(plan.tier)?.posts === most)?.tier
    : undefined;
  const fits =
    whole ??
    offered[Math.min(pace ? PACE_PLAN[pace] : 0, offered.length - 1)]?.tier;
  // The plan that fits the pace until the person picks one; a pick carries
  // over to the other interval, which sells the same tiers.
  const tier =
    offered.find((plan) => plan.tier === picked)?.tier ??
    fits ??
    offered[0]?.tier;
  const chosen = offered.find((plan) => plan.tier === tier);
  const saving = yearlySaving(plans);
  const month =
    strategy && strategy.calendar.length > 0 ? monthOf(strategy) : null;
  const paceName = PACES.find((option) => option.level === pace)?.name;

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
      </div>

      {month ? (
        <ul className="card ob-gets" aria-label="What you get">
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              <b>{month.pieces} posts</b> from your strategy
              {month.channels.length > 0
                ? ` for ${joinNames(month.channels)}`
                : ""}
              , written in your voice
            </span>
          </li>
          {month.pictures + month.videos > 0 ? (
            <li>
              <Check size={16} aria-hidden="true" />
              <span>
                {[
                  month.pictures > 0
                    ? `${month.pictures} ${month.pictures === 1 ? "picture" : "pictures"}`
                    : "",
                  month.videos > 0
                    ? `${month.videos} ${month.videos === 1 ? "video" : "videos"}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                made from your brand
              </span>
            </li>
          ) : null}
          <li>
            <Check size={16} aria-hidden="true" />
            <span>
              Every day {AGENT_NAME} answers comments and watches the news;
              every week he checks the numbers
            </span>
          </li>
        </ul>
      ) : null}

      {plans.length === 0 ? (
        <p className="alert" role="alert">
          Plans aren't available right now. Reload the page to try again.
        </p>
      ) : (
        <>
          <div className="ob-tabs" role="group" aria-label="Billing">
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
              Yearly{saving > 0 ? ` · save ${saving}%` : ""}
            </button>
          </div>

          <div className="ob-plan-options" role="group" aria-label="Plan">
            {offered.map((plan, place) => (
              <button
                key={plan.tier}
                type="button"
                aria-pressed={plan.tier === tier}
                className="card ob-plan-option"
                onClick={() => setPicked(plan.tier)}
              >
                {plan.tier === whole && offered.length > 1 ? (
                  <span className="ob-plan-fit">Makes all of it</span>
                ) : plan.tier === fits && paceName && !whole ? (
                  <span className="ob-plan-fit">Fits your {paceName} pace</span>
                ) : null}
                <span className="ob-plan-name">{tierName(plan.tier)}</span>
                <span className="ob-value">
                  {price(plan, interval === "year" ? 12 : 1)}{" "}
                  <span className="ob-small muted">a month</span>
                </span>
                {makes.get(plan.tier) ? (
                  <span className="ob-small">
                    {makesLine(
                      makes.get(plan.tier) as ReturnType<typeof planMakes>,
                    )}
                  </span>
                ) : PLAN_LINES[place] ? (
                  <span className="ob-small">{PLAN_LINES[place]}</span>
                ) : null}
                {place === PLAN_LINES.length - 1 ? (
                  <span className="ob-small">{TEAM_CHECK}</span>
                ) : null}
                <span className="ob-small muted">
                  {plan.credits.toLocaleString("en")} credits a month
                </span>
                {interval === "year" ? (
                  <span className="ob-small muted">
                    {price(plan)} billed once a year
                  </span>
                ) : null}
              </button>
            ))}
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
                ? `Start ${tierName(chosen.tier)} for ${price(chosen, interval === "year" ? 12 : 1)} a month`
                : "Continue to payment"}
            {opening ? null : <ArrowRight size={16} aria-hidden="true" />}
          </button>
          <ul className="ob-trust">
            <li>Change or cancel any time in Settings</li>
            <li>Discount codes work at checkout</li>
            <li>Secure payment with Polar</li>
          </ul>
          <p className="ob-small muted">
            Nothing goes out until you connect your accounts, next.
          </p>
          {skip ? <SkipSubscriptionButton skip={skip} /> : null}
        </>
      )}
    </section>
  );
}
