"use client";

import { AGENT_NAME } from "../lib/agent";
import "./strategy-core.css";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  ChartLine,
  Loader2,
  Search,
  ShoppingBag,
} from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";

import { channelLabel } from "../lib/calendar";
import { channelKey } from "../lib/channels";
import { ChannelIcon } from "./channel-icon";
import { StatusText } from "./status";

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
  onAsk?: (text: string, label?: string) => Promise<void>;
}) {
  // Plain state, not a transition: the host shows its re-planning screen at
  // once, and a refusal stays here instead of throwing.
  const [picked, setPicked] = useState<string | null>(null);
  const switching = picked !== null;
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
              onClick={async () => {
                setPicked(alternative.sentence);
                try {
                  await onAsk(
                    `Switch to this strategy instead and re-plan the month around it: "${alternative.sentence}"`,
                    "Another strategy",
                  );
                } catch {
                  // The host shows the refusal.
                } finally {
                  setPicked(null);
                }
              }}
            >
              {picked === alternative.sentence ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
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

/** The classic funnel step each stage is, and what people do there. */
const STAGES: Record<Stage["stage"], { label: string; people: string }> = {
  awareness: { label: "Awareness", people: "People who could buy hear of you" },
  consideration: { label: "Consideration", people: "They weigh you up" },
  conversion: { label: "Conversion", people: "They buy or sign up" },
  loyalty: { label: "Loyalty", people: "They come back" },
};

/** The classic name of a stage: "Awareness". */
export function stageLabel(stage: Stage["stage"]): string {
  return STAGES[stage].label;
}

/**
 * The funnel, one card a stage: the classic step, the goal, what Cuso does
 * there on which channels, the owner's part, and the number that shows it
 * works with how that number is known. Nothing is folded away.
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
      {stages.map((stage, index) => {
        const { label, people } = STAGES[stage.stage];
        return (
          <li key={stage.stage} className="sc-stage">
            <FunnelSegment index={index} of={stages.length}>
              <span className="sc-stage-number num">{index + 1}</span>
              <h3 className="sc-stage-name">{label}</h3>
              <span className="sc-stage-people">{people}</span>
            </FunnelSegment>
            <div className="sc-stage-body">
              <p className="sc-goal">{stage.goal}</p>
              <dl className="sc-stage-parts">
                <div>
                  <dt>What {AGENT_NAME} does</dt>
                  <dd>
                    <CusoPart stage={stage} />
                  </dd>
                </div>
                <div>
                  <dt>What you do</dt>
                  <dd>
                    <OwnerPart stage={stage} improvements={improvements} />
                  </dd>
                </div>
                <div>
                  <dt>How we know it works</dt>
                  <dd>
                    <MeasurePart stage={stage} />
                  </dd>
                </div>
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** How wide the funnel still is, in percent, where its last stage ends. */
const FUNNEL_END = 40;
/** A stage's fill, top to bottom; the last one, the sale, is always green. */
const SEGMENT_FILLS = ["paper", "iris", "yellow"] as const;

/**
 * One stage's slice of the funnel: as wide at its top as the stage above
 * ends, narrower at its bottom, so the stages stack into one funnel.
 */
function FunnelSegment({
  index,
  of,
  children,
}: {
  index: number;
  of: number;
  children: ReactNode;
}) {
  const edge = (at: number) =>
    ((100 - FUNNEL_END) / 2) * (at / Math.max(of, 1));
  const [top, bottom] = [edge(index), edge(index + 1)];
  const fill = index === of - 1 ? "green" : (SEGMENT_FILLS[index] ?? "yellow");
  return (
    <div
      className={`sc-segment ${fill}`}
      style={{ ["--sc-inset" as string]: `${bottom}%` }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polygon
          points={`${top},0 ${100 - top},0 ${100 - bottom},100 ${bottom},100`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="sc-segment-text">{children}</div>
    </div>
  );
}

/** Cuso's work at a stage, one line a channel. */
function CusoPart({ stage }: { stage: Stage }) {
  const plays = stage.plays ?? [];
  if (plays.length > 0) {
    return (
      <ul className="sc-plays">
        {plays.map((play) => (
          <li key={`${play.channel}:${play.what}`}>
            <span className="sc-play-channel">
              <ChannelIcon
                channel={channelKey(play.channel) ?? play.channel}
                size={16}
              />
              {channelLabel(play.channel)}
            </span>
            <span>{play.what}</span>
          </li>
        ))}
      </ul>
    );
  }
  const channels = stage.channels ?? [];
  if (stage.owner === "you" || channels.length === 0) {
    return <p>Nothing here. This step is yours.</p>;
  }
  return (
    <ul className="sc-plays">
      {channels.map((channel) => (
        <li key={channel}>
          <span className="sc-play-channel">
            <ChannelIcon channel={channelKey(channel) ?? channel} size={16} />
            {channelLabel(channel)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The owner's part: their own pages at the sale, with Cuso's ideas for them. */
function OwnerPart({
  stage,
  improvements,
}: {
  stage: Stage;
  improvements: NonNullable<Strategy["improvements"]>;
}) {
  const owner = stage.owner ?? "cuso";
  if (owner === "cuso") return <p>Nothing. {AGENT_NAME} runs this step.</p>;
  const ideas =
    stage.stage === "conversion"
      ? improvements.filter((item) =>
          ["landing", "pricing", "checkout"].includes(item.area),
        )
      : [];
  if (ideas.length === 0) {
    return (
      <p>
        {owner === "you"
          ? "This step happens on your own pages, product or sales."
          : `Your pages and offer do the rest. ${AGENT_NAME} suggests changes, you decide.`}
      </p>
    );
  }
  return (
    <ul className="sc-ideas">
      {ideas.map((item) => (
        <li key={item.idea}>
          <span>{item.idea}</span>
          <span className="note">{item.why}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A value short enough to stand as a big number: "About 400 a month". A
 * sentence ("X has 33.4K followers; visits are not reported.") reads as words.
 */
function isFigure(value: string): boolean {
  return value.trim().split(/\s+/).length <= 5;
}

/** The stage's number, today's value and whether it is measured or estimated. */
function MeasurePart({ stage }: { stage: Stage }) {
  const { measure } = stage;
  return (
    <div className="sc-measure">
      <span>{stage.metric}</span>
      {measure?.value && measure.basis !== "unknown" ? (
        isFigure(measure.value) ? (
          <b className="num">{measure.value}</b>
        ) : (
          <span>{measure.value}</span>
        )
      ) : null}
      {measure?.basis === "measured" ? (
        <StatusText>
          {measure.source ? `Measured in ${measure.source}` : "Measured"}
        </StatusText>
      ) : (
        <span className="note">
          {measure?.basis === "estimated"
            ? `${AGENT_NAME}'s estimate`
            : "Not measured yet"}
        </span>
      )}
    </div>
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
        <span className="label">With {AGENT_NAME}</span>
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

export const PACES: { level: Pace; name: string; does: string }[] = [
  { level: "steady", name: "Steady", does: "One a day on each network" },
  { level: "active", name: "Active", does: "Two a day on each network" },
  {
    level: "all_in",
    name: "All-in",
    does: "Up to three a day on each network",
  },
];

export function money(amount: number, currency: string): string {
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
  const [saving, setSaving] = useState(false);
  const value = Number(amount.replace(/[^\d.]/g, ""));
  return (
    <div className="sc-ads">
      <p className="sc-ads-amount">
        <b className="num">{money(ads.monthly, ads.currency)}</b>
        <span className="note">
          a month
          {ads.setByOwner ? ", your budget" : `, ${AGENT_NAME}'s suggestion`}
        </span>
      </p>
      <p>{ads.monthly > 0 ? ads.expect : ads.without}</p>
      {ads.monthly > 0 ? (
        <p className="note">Without ads: {ads.without}</p>
      ) : null}
      <p className="note">
        Ads are the only extra cost. You pay the ad networks directly;{" "}
        {AGENT_NAME}
        never spends more than this.
      </p>
      {onSetAds ? (
        editing ? (
          <form
            className="sc-ads-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!Number.isFinite(value) || value < 0) return;
              setSaving(true);
              try {
                await onSetAds(value, ads.currency);
                setEditing(false);
              } catch {
                // The host shows the refusal; the amount stays to try again.
              } finally {
                setSaving(false);
              }
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
            <button
              type="submit"
              className="button button-secondary button-small"
              disabled={saving}
            >
              {saving ? "Saving…" : "Set budget"}
            </button>
            <button
              type="button"
              className="button button-ghost button-small"
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
          {item.now ? <span className="note">Now: {item.now}</span> : null}
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
                <StatusText>Connected</StatusText>
              ) : (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={pending !== null}
                  onClick={() => connect(source.provider)}
                >
                  {pending === source.provider ? (
                    <Loader2 size={14} className="spin" aria-hidden="true" />
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
