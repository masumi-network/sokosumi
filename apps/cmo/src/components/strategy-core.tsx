"use client";

import "./strategy-core.css";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  ChartLine,
  Check,
  Loader2,
  Search,
  ShoppingBag,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { channelLabel } from "../lib/calendar";
import { channelKey } from "../lib/channels";
import { ChannelIcon } from "./channel-icon";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Stage = NonNullable<Strategy["funnel"]>[number];
type Pace = NonNullable<Strategy["pace"]>["level"];
type Source = CmoOverview["measurement"][number];

const SOURCE_ICONS = {
  google_analytics: ChartLine,
  google_search_console: Search,
  shopify: ShoppingBag,
} as const;

/** The four parts of the strategy, under the sentence that joins them. */
export function IdeaParts({ idea }: { idea: NonNullable<Strategy["idea"]> }) {
  const parts: [string, string][] = [
    ["Who", idea.who],
    ["Positioned as", idea.position],
    ["How they find you", idea.attract],
    ["The offer", idea.offer],
  ];
  return (
    <dl className="sc-parts">
      {parts.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The other strategies Cuso weighed; one tap asks him to switch. */
export function Alternatives({
  alternatives,
  onAsk,
}: {
  alternatives: NonNullable<Strategy["alternatives"]>;
  onAsk?: (text: string) => Promise<void>;
}) {
  const [switching, startSwitching] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <ul className="sc-alts">
      {alternatives.map((alternative) => (
        <li key={alternative.sentence}>
          <p>{alternative.sentence}</p>
          <p className="note">{alternative.why}</p>
          {onAsk ? (
            <button
              type="button"
              className="sc-link"
              disabled={switching}
              onClick={() =>
                startSwitching(async () => {
                  setPicked(alternative.sentence);
                  await onAsk(
                    `Switch to this strategy instead and re-plan the month around it: "${alternative.sentence}"`,
                  );
                })
              }
            >
              {switching && picked === alternative.sentence ? (
                <Loader2 size={14} className="ob-spin" aria-hidden="true" />
              ) : null}
              Use this one instead
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** What starts the funnel, what it sells, what follows. */
export function OfferLadder({
  ladder,
}: {
  ladder: NonNullable<Strategy["ladder"]>;
}) {
  const steps = [
    ["First step", ladder.entry],
    ["Main offer", ladder.core],
    ["Then", ladder.next],
  ] as const;
  return (
    <ol className="sc-ladder">
      {steps.map(([label, step]) =>
        step ? (
          <li key={label}>
            <span className="label">{label}</span>
            <b>{step.what}</b>
            {step.why ? <span className="note">{step.why}</span> : null}
          </li>
        ) : null,
      )}
    </ol>
  );
}

const OWNERS: Record<NonNullable<Stage["owner"]>, string> = {
  cuso: "Cuso runs this",
  you: "On your side",
  shared: "Cuso and you",
};

const BASES = {
  measured: "Measured",
  estimated: "Estimate",
  unknown: "Not measured yet",
} as const;

/**
 * The funnel, top to bottom: each stage's job, what every channel does there
 * and how often, who moves it, and today's number with how it is known.
 */
export function FunnelPlan({
  stages,
  improvements,
}: {
  stages: Stage[];
  improvements: NonNullable<Strategy["improvements"]>;
}) {
  return (
    <ol className="sc-funnel">
      {stages.map((stage, index) => (
        <li
          key={stage.stage}
          className={`sc-stage ${stage.owner ?? "cuso"}`}
          style={{ ["--sc-step" as string]: index }}
        >
          <div className="sc-stage-head">
            <span className="sc-stage-name">{stage.name}</span>
            <span className={`sc-owner ${stage.owner ?? "cuso"}`}>
              {OWNERS[stage.owner ?? "cuso"]}
            </span>
          </div>
          <p className="sc-goal">{stage.goal}</p>
          {(stage.plays ?? []).length > 0 ? (
            <ul className="sc-plays">
              {(stage.plays ?? []).map((play) => (
                <li key={`${play.channel}:${play.what}`}>
                  <ChannelIcon
                    channel={channelKey(play.channel) ?? play.channel}
                    size={16}
                  />
                  <span className="sc-play-channel">
                    {channelLabel(play.channel)}
                  </span>
                  <span>{play.what}</span>
                  {play.cadence ? (
                    <span className="sc-cadence">{play.cadence}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {stage.owner === "you" || stage.owner === "shared" ? (
            <StageImprovements stage={stage} improvements={improvements} />
          ) : null}
          <p className="sc-measure">
            <span>{stage.metric}</span>
            {stage.measure?.value ? (
              <b className="num">{stage.measure.value}</b>
            ) : null}
            <span className={`sc-basis ${stage.measure?.basis ?? "unknown"}`}>
              {BASES[stage.measure?.basis ?? "unknown"]}
              {stage.measure?.basis === "measured" && stage.measure.source
                ? ` · ${stage.measure.source}`
                : ""}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
}

/** The owner's own pages at a conversion stage: Cuso suggests, they decide. */
function StageImprovements({
  stage,
  improvements,
}: {
  stage: Stage;
  improvements: NonNullable<Strategy["improvements"]>;
}) {
  const relevant =
    stage.stage === "conversion"
      ? improvements.filter((item) =>
          ["landing", "pricing", "checkout"].includes(item.area),
        )
      : [];
  if (relevant.length === 0) return null;
  return (
    <ul className="sc-fixes">
      {relevant.map((item) => (
        <li key={item.idea}>
          <b>{item.idea}</b>
          <span className="note">{item.why}</span>
        </li>
      ))}
    </ul>
  );
}

/** Each channel today, and what this plan makes it. */
export function BeforeAfter({
  rows,
}: {
  rows: NonNullable<Strategy["beforeAfter"]>;
}) {
  return (
    <ul className="sc-ba">
      <li className="sc-ba-head" aria-hidden="true">
        <span />
        <span className="label">Today</span>
        <span />
        <span className="label">With Cuso</span>
      </li>
      {rows.map((row) => (
        <li key={row.channel}>
          <span className="sc-ba-channel">
            <ChannelIcon
              channel={channelKey(row.channel) ?? row.channel}
              size={16}
            />
            {channelLabel(row.channel)}
          </span>
          <span className="sc-ba-before">{row.before}</span>
          <ArrowRight size={14} aria-hidden="true" className="sc-ba-arrow" />
          <span className="sc-ba-after">{row.after}</span>
        </li>
      ))}
    </ul>
  );
}

const PACES: { level: Pace; name: string; does: string }[] = [
  { level: "steady", name: "Steady", does: "A few strong pieces a week" },
  { level: "active", name: "Active", does: "About one a day" },
  { level: "all_in", name: "All-in", does: "Several a day, video first" },
];

/** How hard the plan publishes: Cuso's pick, one tap to change. */
export function PacePicker({
  pace,
  onAsk,
}: {
  pace: NonNullable<Strategy["pace"]>;
  onAsk?: (text: string) => Promise<void>;
}) {
  const [changing, startChanging] = useTransition();
  const [asked, setAsked] = useState<Pace | null>(null);
  return (
    <div className="sc-pace">
      <div className="sc-pace-options" role="group" aria-label="Pace">
        {PACES.map((option) => {
          const current = option.level === pace.level;
          return (
            <button
              key={option.level}
              type="button"
              className={current ? "sc-pace-option current" : "sc-pace-option"}
              aria-pressed={current}
              disabled={!onAsk || current || changing}
              onClick={() =>
                startChanging(async () => {
                  setAsked(option.level);
                  await onAsk?.(
                    `Change the pace to ${option.name} (${option.does.toLowerCase()}) and re-plan the calendar to match.`,
                  );
                })
              }
            >
              <b>{option.name}</b>
              <span>{option.does}</span>
              {changing && asked === option.level ? (
                <Loader2 size={14} className="ob-spin" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="note">
        {pace.perWeek} pieces a week. {pace.why}
      </p>
    </div>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * Paid ads, the only part that costs more: Cuso's amount and what it should
 * bring, what happens without it, and the owner's own figure.
 */
export function AdBudget({
  ads,
  onSetAds,
}: {
  ads: NonNullable<Strategy["ads"]>;
  onSetAds?: (monthly: number, currency: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(ads.monthly));
  const [saving, startSaving] = useTransition();
  const value = Number(amount.replace(/[^\d.]/g, ""));
  return (
    <div className="sc-ads">
      <p className="sc-ads-amount">
        <b className="num">{money(ads.monthly, ads.currency)}</b>
        <span className="note">
          a month{ads.setByOwner ? ", your budget" : ", Cuso's suggestion"}
        </span>
      </p>
      <p>{ads.monthly > 0 ? ads.expect : ads.without}</p>
      {ads.monthly > 0 ? (
        <p className="note">Without ads: {ads.without}</p>
      ) : null}
      <p className="note">
        Ads are the only extra cost. You pay the ad networks directly; Cuso
        never spends more than this.
      </p>
      {onSetAds ? (
        editing ? (
          <form
            className="sc-ads-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!Number.isFinite(value) || value < 0) return;
              startSaving(async () => {
                await onSetAds(value, ads.currency);
                setEditing(false);
              });
            }}
          >
            <label className="sc-ads-input">
              <span>{ads.currency}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label={`Monthly ad budget in ${ads.currency}`}
              />
            </label>
            <button type="submit" className="ob-button" disabled={saving}>
              {saving ? "Saving…" : "Set budget"}
            </button>
            <button
              type="button"
              className="ob-button ob-button-quiet"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="sc-link"
            onClick={() => setEditing(true)}
          >
            Set your own budget
          </button>
        )
      ) : null}
    </div>
  );
}

const AREAS: Record<
  NonNullable<Strategy["improvements"]>[number]["area"],
  string
> = {
  landing: "Landing page",
  pricing: "Pricing",
  checkout: "Checkout",
  site: "Website",
  seo: "Search",
  product: "Product",
};

/** What only the owner can change, because it lives on their side. */
export function Improvements({
  items,
}: {
  items: NonNullable<Strategy["improvements"]>;
}) {
  return (
    <ul className="sc-improve">
      {items.map((item) => (
        <li key={item.idea}>
          <span className="label">{AREAS[item.area]}</span>
          <b>{item.idea}</b>
          <span className="note">{item.why}</span>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="note"
            >
              {item.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Where Cuso reads the funnel's real numbers. Each source is optional; what
 * none of them covers, Cuso estimates and asks the owner for.
 */
export function MeasureFunnel({
  sources,
  onConnect,
}: {
  sources: Source[];
  onConnect: (
    provider: Source["provider"],
  ) => Promise<{ url: string | null; error: string | null }>;
}) {
  const [pending, setPending] = useState<Source["provider"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("measure") === "failed"
    ) {
      setError("That connection didn't finish. Try again.");
    }
  }, []);

  function connect(provider: Source["provider"]) {
    setPending(provider);
    setError(null);
    startTransition(async () => {
      try {
        const result = await onConnect(provider);
        if (result.url) {
          window.location.assign(result.url);
          return;
        }
        setError(result.error);
      } catch {
        setError("Could not connect. Try again.");
      }
      setPending(null);
    });
  }

  return (
    <div className="sc-sources">
      <ul>
        {sources.map((source) => {
          const Icon = SOURCE_ICONS[source.provider];
          return (
            <li key={source.provider}>
              <span className="sc-source-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="sc-source-text">
                <b>{source.name}</b>
                <span className="note">{source.measures}</span>
              </span>
              {source.status === "connected" ? (
                <span className="sc-source-done">
                  <Check size={14} aria-hidden="true" />
                  Connected
                </span>
              ) : (
                <button
                  type="button"
                  className="sc-source-button"
                  disabled={pending !== null}
                  onClick={() => connect(source.provider)}
                >
                  {pending === source.provider ? (
                    <Loader2 size={14} className="sc-spin" aria-hidden="true" />
                  ) : null}
                  {source.status === "pending"
                    ? "Finish connecting"
                    : "Connect"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="sc-source-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
