"use client";

import type {
  CmoOverview,
  SubscriptionCatalog,
  SubscriptionCatalogPlan,
} from "@sokosumi/core-client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useTransition } from "react";

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
  onBack?: () => void;
  onStart: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

/**
 * Sokosumi's plans, as Core prices them. Checkout happens on Sokosumi; this
 * step notices the subscription when the founder comes back.
 */
export function PricingStep({
  overview,
  plans,
  onBack,
  onStart,
  onRefresh,
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

  return (
    <section className="ob-pricing">
      {onBack ? (
        <button type="button" className="ob-back" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" /> Accounts
        </button>
      ) : null}
      <p className="ob-eyebrow">Plan</p>
      <h1 className="ob-title">
        {subscribed ? "You're all set" : "Pick a plan and Cuso starts today"}
      </h1>
      <p className="ob-lede">
        Cuso runs on Sokosumi credits. Every plan includes monthly credits; his
        daily work, weekly review and monthly plan all draw from them.
      </p>

      {plans ? (
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

      <div className="ob-footer">
        <button
          type="button"
          className={subscribed ? "ob-button ob-button-lg" : "ob-button-text"}
          disabled={starting}
          onClick={() => startStarting(onStart)}
        >
          {starting
            ? "Starting…"
            : subscribed
              ? "Start Cuso"
              : "Start without a plan for now"}
          {subscribed ? <ArrowRight size={16} aria-hidden="true" /> : null}
        </button>
        {subscribed ? null : (
          <p className="ob-note">
            Without a plan Cuso keeps your strategy and checks in, but doesn't
            schedule posts.
          </p>
        )}
      </div>
    </section>
  );
}
