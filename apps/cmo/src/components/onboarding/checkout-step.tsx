"use client";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import {
  cmoMonthAtLevel,
  cmoMonthFloor,
  cmoVolumeLevelForTier,
} from "@sokosumi/utils";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
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
 * How a plan is framed beside its name: Growth as the start, Scale as the
 * plan with everything. Judgements, not counts: nothing says how many pick
 * a plan.
 */
const PLAN_FRAMES: Record<string, string> = {
  growth: "Strong start",
  scale: "Everything included",
};

/**
 * What credits buy, from Core's prices: a Muse Image picture is $0.01 (1
 * credit); a short video's music is $0.10, plus its voice and captions when
 * it speaks. Cuso's own work is paid from the same credits, so this names
 * prices, never a count a plan makes.
 */
const CREDITS_BUY =
  "Credits pay for everything Cuso makes: a picture costs 1 credit, a short video about 10 to 20.";

/** The guarantee, as plainly as it can be said. */
const REFUND = "Not happy in the first 14 days? Full refund.";

/** Who says so, verbatim (approved by the owner, 2026-11-25). */
const QUOTE = {
  text: "CMO.xyz complements and connects our established agency offerings. Agentic services enable interaction, and with it the thread that ties together all of our AI applications and services.",
  name: "Florian Haller",
  role: "CEO, Serviceplan Group",
  photo: "/florian-haller.webp",
};

/** A plan's monthly credits, in plain words. */
function creditsLine(credits: number): string {
  return `${credits.toLocaleString("en")} AI credits a month`;
}

/**
 * How many posts a plan makes of this strategy a month, as they go out (a
 * short video is a post on each network): the month is written at the top
 * volume, and each plan makes its share of it (Core makes the same).
 */
function planPosts(strategy: Strategy, tier: string): number {
  // cmo-v22: Core writes the month after payment, so each plan promises
  // its floor, from the strategy's networks alone.
  if (strategy.monthWriter)
    return cmoMonthFloor(strategy.channels, cmoVolumeLevelForTier(tier)).total;
  const { made } = cmoMonthAtLevel(
    strategy.calendar,
    cmoVolumeLevelForTier(tier),
  );
  return postsGoingOut(strategy.calendar, made);
}

/** What a plan makes of the month, in one plain line. */
function postsLine(posts: number, most: number, floor: boolean): string {
  if (floor) return `At least ${posts} posts a month`;
  if (posts >= most) return `All ${posts} posts a month`;
  const about = posts >= 20 ? Math.round(posts / 10) * 10 : posts;
  return `About ${about} posts a month`;
}

/** A plan's price in its currency's main unit. */
function price(plan: CmoSubscriptionPlan, months = 1): string {
  return money(plan.priceAmount / 100 / months, plan.currency.toUpperCase());
}

/** The tier's slug is Polar's; only its first letter is ours. */
function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/**
 * The switch's word for the yearly saving: whole free months when every plan's
 * year costs a whole number of its months less than twelve, else a percent.
 */
function yearlyLabel(plans: CmoSubscriptionPlan[]): string | null {
  const free = plans
    .filter((plan) => plan.interval === "year")
    .flatMap((year) => {
      const month = monthlyOf(plans, year.tier);
      return month ? [12 - year.priceAmount / month.priceAmount] : [];
    });
  const months = free[0];
  if (
    months !== undefined &&
    Number.isInteger(months) &&
    months >= 1 &&
    free.every((each) => each === months)
  ) {
    return months === 1 ? "1 month free" : `${months} months free`;
  }
  const saving = yearlySaving(plans);
  return saving > 0 ? `Save ${saving}%` : null;
}

function monthlyOf(
  plans: CmoSubscriptionPlan[],
  tier: string,
): CmoSubscriptionPlan | undefined {
  return plans.find((plan) => plan.interval === "month" && plan.tier === tier);
}

/** A tier's year paid at once against twelve months of it, in minor units. */
function savedInAYear(plans: CmoSubscriptionPlan[], tier: string): number {
  const month = monthlyOf(plans, tier);
  const year = plans.find(
    (plan) => plan.interval === "year" && plan.tier === tier,
  );
  return month && year
    ? Math.max(0, month.priceAmount * 12 - year.priceAmount)
    : 0;
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
  // cmo-v22: the calendar holds a few examples; the plan's networks are its own.
  if (strategy?.monthWriter)
    return NETWORKS.filter((network) =>
      strategy.channels.some((entry) => channelKey(entry.channel) === network),
    );
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
  // The smallest plan that makes the whole strategy. A cmo-v22 strategy has
  // no whole month yet, only floors: the top one is picked, never named so.
  const floors = Boolean(planned?.monthWriter);
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
  const yearly = yearlyLabel(plans);
  const networks = strategyNetworks(strategy);
  const months = interval === "year" ? 12 : 1;
  // Every card keeps the frame's row when any has one, so the rows line up.
  const framed =
    offered.length > 1 && offered.some((plan) => PLAN_FRAMES[plan.tier]);

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
              {yearly ? <span className="ob-save">{yearly}</span> : null}
            </button>
          </div>

          <div className="ob-plan-options" role="group" aria-label="Plan">
            {offered.map((plan, place) => {
              const monthly = plans.find(
                (other) =>
                  other.interval === "month" && other.tier === plan.tier,
              );
              const posts = makes.get(plan.tier);
              const saved = savedInAYear(plans, plan.tier);
              const top = offered.length > 1 && place === offered.length - 1;
              const frame = framed ? PLAN_FRAMES[plan.tier] : undefined;
              return (
                <button
                  key={plan.tier}
                  type="button"
                  aria-pressed={plan.tier === tier}
                  className={
                    top
                      ? "card ob-plan-option ob-plan-top"
                      : "card ob-plan-option"
                  }
                  onClick={() => setPicked(plan.tier)}
                >
                  {plan.tier === whole && offered.length > 1 && !floors ? (
                    <span className="ob-plan-fit">Makes all of it</span>
                  ) : null}
                  <span className="ob-plan-name">{tierName(plan.tier)}</span>
                  {framed ? (
                    frame ? (
                      <span
                        className={
                          top
                            ? "ob-plan-frame ob-plan-frame-top"
                            : "ob-plan-frame"
                        }
                      >
                        {frame}
                      </span>
                    ) : (
                      <span className="ob-plan-frame-room" aria-hidden="true" />
                    )
                  ) : null}
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
                    <span className="ob-small">
                      {postsLine(posts, most, floors)}
                    </span>
                  ) : PLAN_LINES[place] ? (
                    <span className="ob-small">{PLAN_LINES[place]}</span>
                  ) : null}
                  <span className="ob-small">{creditsLine(plan.credits)}</span>
                  {saved > 0 ? (
                    <span
                      key={`${interval}-saved`}
                      className="ob-small ob-swap"
                    >
                      {interval === "year"
                        ? `You save ${money(saved / 100, plan.currency.toUpperCase())} a year`
                        : `Yearly saves ${money(saved / 100, plan.currency.toUpperCase())}`}
                    </span>
                  ) : null}
                  {top ? (
                    <span className="ob-small ob-plan-extra">
                      <Check size={14} aria-hidden="true" />
                      {TEAM_CHECK}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <p className="ob-small muted ob-credits-buy">{CREDITS_BUY}</p>

          <figure className="ob-quote">
            <blockquote>“{QUOTE.text}”</blockquote>
            <figcaption>
              <img
                className="ob-quote-avatar"
                src={QUOTE.photo}
                alt={QUOTE.name}
                width={40}
                height={40}
              />
              <span>
                <span className="ob-quote-name">{QUOTE.name}</span>
                <span className="muted">{QUOTE.role}</span>
              </span>
            </figcaption>
          </figure>

          {error ? (
            <p className="alert" role="alert">
              {error}
            </p>
          ) : null}

          {/* On a phone this bar stays on screen while the plans scroll. */}
          <div className="ob-start">
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
          </div>
          <ul className="ob-assure">
            <li>
              <Check size={14} aria-hidden="true" />
              Cancel any time.
            </li>
            <li>
              <Check size={14} aria-hidden="true" />
              {REFUND}
            </li>
          </ul>
          <ShortLegalNotice />
          {skip ? <SkipSubscriptionButton skip={skip} /> : null}
        </>
      )}
    </section>
  );
}
