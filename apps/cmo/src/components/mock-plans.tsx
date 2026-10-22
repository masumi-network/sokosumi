"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import {
  type BillingInterval,
  MOCK_PLANS,
  mockPlanFeatures,
} from "../lib/mock-plans";

const euros = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

interface MockPlanTableProps {
  current: string | null;
  /** Activates the tier; the refusal, if any. */
  choose: (planId: string) => Promise<string | null>;
}

/** CMO's tiers with a monthly or yearly price; choosing one needs no checkout. */
export function MockPlanTable({ current, choose }: MockPlanTableProps) {
  const [interval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function pick(planId: string) {
    setPending(planId);
    setError(null);
    startTransition(async () => {
      setError(await choose(planId));
      setPending(null);
    });
  }

  return (
    <div className="mp">
      <div className="mp-toggle" role="radiogroup" aria-label="Billing">
        {(["monthly", "yearly"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={interval === option}
            className={interval === option ? "on" : undefined}
            onClick={() => setBillingInterval(option)}
          >
            {option === "monthly" ? "Monthly" : "Yearly"}
            {option === "yearly" ? (
              <span className="mp-save">Save 20%</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="mp-grid">
        {MOCK_PLANS.map((plan) => {
          const active = plan.id === current;
          const price = interval === "monthly" ? plan.monthly : plan.yearly;
          return (
            <article
              key={plan.id}
              className={[
                "mp-plan",
                plan.recommended ? "featured" : "",
                active ? "active" : "",
              ].join(" ")}
            >
              <header className="mp-head">
                <h3>{plan.name}</h3>
                {active ? (
                  <span className="mp-badge current">Your plan</span>
                ) : plan.recommended ? (
                  <span className="mp-badge">Recommended</span>
                ) : null}
              </header>
              <p className="mp-blurb">{plan.blurb}</p>
              <p className="mp-price">
                <span className="num">{euros.format(price)}</span>
                <span className="mp-per">/month</span>
              </p>
              <p className="mp-billed">
                {interval === "yearly"
                  ? `${euros.format(price * 12)} billed yearly`
                  : "Billed monthly, cancel any time"}
              </p>
              <button
                type="button"
                className={
                  plan.recommended && !active
                    ? "mp-choose primary"
                    : "mp-choose"
                }
                disabled={active || pending !== null}
                onClick={() => pick(plan.id)}
              >
                {pending === plan.id ? (
                  <Loader2 size={14} className="spin" aria-hidden="true" />
                ) : null}
                {active ? "Current plan" : `Choose ${plan.name}`}
              </button>
              <ul className="mp-features">
                {mockPlanFeatures(plan).map((feature) => (
                  <li key={feature}>
                    <Check size={14} aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <p className="mp-note">Test checkout: choosing a plan bills nothing.</p>
    </div>
  );
}
