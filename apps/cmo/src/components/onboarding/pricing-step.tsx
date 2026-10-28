"use client";

import type {
  CmoOverview,
  SubscriptionCatalog,
  SubscriptionCatalogPlan,
} from "@sokosumi/core-client";
import { ArrowRight, Check, ExternalLink, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useTransition } from "react";

import { calendarKind, socialPostsPerWeek } from "../../lib/calendar";
import {
  channelInfo,
  formatHasImage,
  formatHasVideo,
} from "../../lib/channels";
import { fittingMockPlan, mockPlanById } from "../../lib/mock-plans";
import { MockPlanTable } from "../mock-plans";
import { strategySocialChannels } from "./connect-step";
import { StepHead } from "./step-head";

const PAID = ["starter", "standard", "pro"] as const;
const RECOMMENDED = "standard";

function price(plan: SubscriptionCatalogPlan): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: plan.currency.toUpperCase(),
    maximumFractionDigits: plan.monthlyAmount % 100 === 0 ? 0 : 2,
  }).format(plan.monthlyAmount / 100);
}

function title(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface PricingStepProps {
  overview: CmoOverview;
  plans: SubscriptionCatalog | null;
  onStart: () => Promise<void>;
  onRefresh: () => Promise<void>;
  /** Mock checkout: activates a CMO tier; the refusal, if any. */
  onChooseMockPlan: (planId: string) => Promise<string | null>;
}

/**
 * Sokosumi's plans, as Core prices them. Checkout happens on Sokosumi; this
 * step notices the subscription when the founder comes back.
 */
export function PricingStep({
  overview,
  plans,
  onStart,
  onRefresh,
  onChooseMockPlan,
}: PricingStepProps) {
  const [checkingOut, setCheckingOut] = useState(false);
  const [starting, startStarting] = useTransition();
  const subscribed = overview.subscriptionActive;
  const current = overview.billing.plan;

  useEffect(() => {
    if (!checkingOut || subscribed) return;
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void onRefresh();
    };
    window.addEventListener("focus", refreshOnReturn);
    return () => window.removeEventListener("focus", refreshOnReturn);
  }, [checkingOut, subscribed, onRefresh]);

  const subscribeUrl = `${overview.subscribeUrl}?tab=subscription`;
  const channels = strategySocialChannels(overview).length;
  const postsPerWeek = socialPostsPerWeek(overview.strategy?.calendar ?? []);
  // Website, newsletter and ad pieces need a tier with article and ad drafts.
  const drafts = (overview.strategy?.calendar ?? []).some(
    (entry) => entry.status !== "skipped" && calendarKind(entry) !== "post",
  );
  const fit = fittingMockPlan({ channels, postsPerWeek, drafts });
  const connected = overview.channels.some(
    (channel) => channel.status.toUpperCase() === "ACTIVE",
  );
  // Once subscribed, the head's Start Cuso is the way on.
  const later = (
    <div className="ob-footer">
      <button
        type="button"
        className="ob-button ob-button-lg ob-button-quiet"
        disabled={starting}
        onClick={() => startStarting(onStart)}
      >
        {starting ? "Starting…" : "Subscribe later"}
      </button>
      <p className="ob-note">
        Cuso keeps your plan and checks in, but posts nothing until you
        subscribe.
      </p>
    </div>
  );

  return (
    <section className="ob-pricing">
      <StepHead
        step={8}
        title="Pricing"
        mood="cheer"
        say={
          subscribed
            ? "You're all set. I start on your plan today."
            : overview.mockBilling
              ? `${fit.name} fits your plan. Pick it and I start today.`
              : "Pick a plan and I start today."
        }
        action={
          subscribed ? (
            <button
              type="button"
              className="ob-button ob-button-lg"
              disabled={starting}
              onClick={() => startStarting(onStart)}
            >
              {starting ? "Starting…" : "Start Cuso"}
              {starting ? null : <ArrowRight size={16} aria-hidden="true" />}
            </button>
          ) : undefined
        }
      />
      {subscribed ? null : <MonthSummary overview={overview} />}
      {overview.mockBilling ? (
        <>
          <p className="ob-lede">
            {subscribed
              ? `${mockPlanById(overview.mockPlan)?.name ?? "Your"} is active. ${
                  connected
                    ? "Cuso writes and schedules your posts from today."
                    : "Cuso writes your posts from today and starts posting once you connect an account."
                }`
              : postsPerWeek > 0
                ? `About ${formatRate(postsPerWeek)} social posts a week on ${channels} ${channels === 1 ? "network" : "networks"}${drafts ? ", plus everything above" : ""}. Every plan includes a weekly review and a fresh strategy each month.`
                : "Every plan includes a weekly review and a fresh strategy each month."}
          </p>
          <div className="ob-plans-mock">
            <MockPlanTable
              current={overview.mockPlan}
              recommended={fit.id}
              choose={onChooseMockPlan}
            />
          </div>
        </>
      ) : (
        <p className="ob-lede">
          Cuso runs on Sokosumi credits. Every plan includes monthly credits;
          his daily work, weekly review and monthly plan all draw from them.
        </p>
      )}

      {overview.mockBilling ? null : plans ? (
        <div className="ob-plans">
          {PAID.map((name, index) => {
            const plan = plans[name];
            const active = current === name && subscribed;
            return (
              <motion.article
                key={name}
                className={`ob-plan${name === RECOMMENDED ? " featured" : ""}${active ? " active" : ""}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * index }}
              >
                <div className="ob-plan-top">
                  <h2>{title(plan.name)}</h2>
                  {active ? (
                    <span className="ob-tag runs">Your plan</span>
                  ) : name === RECOMMENDED ? (
                    <span className="ob-tag accent">Recommended</span>
                  ) : null}
                </div>
                <p className="ob-price">
                  {price(plan)}
                  <span>/month</span>
                </p>
                <ul className="ob-list ob-checks">
                  <li>
                    <Check size={14} aria-hidden="true" />
                    {plan.credits.toLocaleString("en")} credits every month
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" />
                    Cuso's daily posting, weekly review and monthly plan
                  </li>
                  <li>
                    <Check size={14} aria-hidden="true" />
                    All of Sokosumi's coworkers on the same credits
                  </li>
                </ul>
                {active ? null : (
                  <a
                    className={
                      name === RECOMMENDED
                        ? "ob-button"
                        : "ob-button ob-button-quiet"
                    }
                    href={subscribeUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setCheckingOut(true)}
                  >
                    Choose {title(plan.name)}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
              </motion.article>
            );
          })}
        </div>
      ) : (
        <p className="ob-note">
          Plans couldn't load. You can subscribe on{" "}
          <a
            className="ob-link"
            href={subscribeUrl}
            target="_blank"
            rel="noreferrer"
          >
            Sokosumi billing
          </a>
          .
        </p>
      )}

      {checkingOut && !subscribed ? (
        <p className="ob-note ob-waiting">
          <Loader2 size={14} className="ob-spin" aria-hidden="true" />
          Finish checkout on Sokosumi; this page updates when you're back.
        </p>
      ) : null}

      {subscribed ? null : later}
    </section>
  );
}

/**
 * What the first month holds, counted from the real calendar: the work a
 * founder gets done for them, before they look at a price.
 */
function MonthSummary({ overview }: { overview: CmoOverview }) {
  const calendar = (overview.strategy?.calendar ?? []).filter(
    (entry) => entry.status !== "skipped",
  );
  const count = (group: string, format?: string) =>
    calendar.filter(
      (entry) =>
        channelInfo(entry.channel)?.group === group &&
        (!format || entry.format === format),
    ).length;
  const tiles = [
    { value: count("social"), one: "social post", many: "social posts" },
    { value: count("ads"), one: "ad", many: "ads" },
    {
      value: count("email"),
      one: "newsletter email",
      many: "newsletter emails",
    },
    {
      value: count("search", "article"),
      one: "full article",
      many: "full articles",
    },
    { value: count("search", "page_fix"), one: "page fix", many: "page fixes" },
    {
      value: calendar.filter((entry) =>
        formatHasImage(entry.channel, entry.format),
      ).length,
      one: "with an image",
      many: "with images",
    },
    {
      value: calendar.filter((entry) =>
        formatHasVideo(entry.channel, entry.format),
      ).length,
      one: "video",
      many: "videos",
    },
  ].filter((tile) => tile.value > 0);
  if (tiles.length === 0) return null;
  return (
    <div className="ob-month">
      <p className="ob-label">What Cuso makes in your first month</p>
      <ul className="ob-month-tiles">
        {tiles.map((tile) => (
          <li key={tile.one}>
            <span className="ob-month-n num">{tile.value}</span>
            <span>{tile.value === 1 ? tile.one : tile.many}</span>
          </li>
        ))}
      </ul>
      <p className="ob-note">
        Written in your voice, planned around your goal, and improved every week
        from what works.
        {count("ads") > 0 ? " Ad spend is separate; you set it." : ""}
      </p>
    </div>
  );
}

/** 3.5 reads "3.5", 3 reads "3". */
function formatRate(rate: number): string {
  return String(Math.round(rate * 2) / 2);
}
