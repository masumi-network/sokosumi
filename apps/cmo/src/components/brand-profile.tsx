"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check, Plus, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useId,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { AGENT_NAME } from "../lib/agent";
import {
  type BrandBrain,
  type BrandFinding,
  type BrandSection,
  sourceHost,
} from "../lib/brand-sections";
import { ChannelIcon } from "./channel-icon";
import { SubmitButton } from "./submit-button";

interface OffersProps {
  brain: BrandBrain;
  onSave: (brain: BrandBrain) => Promise<void>;
}

/** One idea: its name on the left, the answer on the right. */
/**
 * What the business sells and what it costs, the main offer first: every
 * plan is built on it. Older Brand Brains only name their products.
 */
export function Offers({ brain, onSave }: OffersProps) {
  // The list changes on the tap; the save follows.
  const [offers, showOffers] = useOptimistic(
    brain.offers ?? [],
    (_shown, next: NonNullable<BrandBrain["offers"]>) => next,
  );
  // What the owner just removed, so one tap brings it back.
  const [removed, setRemoved] = useState<{
    offer: (typeof offers)[number];
    index: number;
  } | null>(null);
  const [saving, startSaving] = useTransition();
  const save = (next: typeof offers) =>
    startSaving(async () => {
      showOffers(next);
      await onSave({ ...brain, offers: next });
    });

  if (offers.length === 0 && !removed) {
    return <p className="bb-big">{brain.products.join(", ")}</p>;
  }
  return (
    <div className="bb-offers-wrap">
      <ul
        className={offers.length > 2 ? "bb-offers bb-offers-grid" : "bb-offers"}
      >
        {offers.map((offer, index) => (
          <li key={offer.name} className="bb-offer">
            <div className="bb-offer-head">
              {index === 0 && offers.length > 1 ? (
                <span className="label">Main offer</span>
              ) : null}
              <b>
                {offer.url ? (
                  <a href={offer.url} target="_blank" rel="noreferrer">
                    {offer.name}
                  </a>
                ) : (
                  offer.name
                )}
              </b>
              <span className="bb-offer-price num">{offer.price}</span>
            </div>
            <span>{offer.what}</span>
            {offer.forWhom ? (
              <span className="note">For {lowerFirst(offer.forWhom)}</span>
            ) : null}
            <button
              type="button"
              className="bb-offer-remove"
              aria-label={`Remove ${offer.name}`}
              title="Remove"
              disabled={saving}
              onClick={() => {
                setRemoved({ offer, index });
                save(offers.filter((_, at) => at !== index));
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {removed ? (
        <p className="bb-undo" aria-live="polite">
          Removed {removed.offer.name}. {AGENT_NAME} won't market it.{" "}
          <button
            type="button"
            className="bb-undo-button"
            disabled={saving}
            onClick={() => {
              const next = [...offers];
              next.splice(removed.index, 0, removed.offer);
              setRemoved(null);
              save(next);
            }}
          >
            Undo
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function Section({
  title,
  wide = false,
  children,
}: {
  title: string;
  /** Takes the full width under its name, for calendars and previews. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={wide ? "card bb-section wide" : "card bb-section"}>
      <h2 className="bb-title">{title}</h2>
      <div className="bb-body">{children}</div>
    </section>
  );
}

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text)
    ? `${text.charAt(0).toLowerCase()}${text.slice(1)}`
    : text;
}

function channels(hex: string): [number, number, number] {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(
    (at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255,
  );
  return [r, g, b];
}

/**
 * The brand colour: the site's own first colour when it is a real colour,
 * not a near grey, near black or near white.
 */
export function coverColor(colors: string[]): string | undefined {
  const usable = colors.filter((hex) => {
    const [r, g, b] = channels(hex);
    const max = Math.max(r, g, b);
    const saturation = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return saturation >= 0.3 && luminance > 0.1 && luminance < 0.85;
  });
  return usable[0] ?? colors[0];
}

/** The brand colour and a soft fill of it. */
export function brandStyle(overview: CmoOverview): CSSProperties | undefined {
  const brand = coverColor(overview.brandVisual?.colors ?? []);
  return brand
    ? ({
        "--brand": brand,
        // The brand colour at about 12%, for soft fills.
        "--brand-soft": `${brand}1f`,
      } as CSSProperties)
    : undefined;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The first sentence, for a Brand Brain written before positioning existed. */
export function firstSentence(text: string): string {
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  return match ? match[0] : text;
}

interface VoiceProps {
  brain: BrandBrain;
}

/** "Clear, direct, practical. Explains the technical plainly." → its first sentence large. */
export function Voice({ brain }: VoiceProps) {
  // The tone's first clause is the headline: "Clear, direct, practical."
  const tone =
    brain.voice.tone.match(/^.+?[.;!?](?=\s|$)/)?.[0] ?? brain.voice.tone;
  const rest = brain.voice.tone.slice(tone.length).trim();
  const more = `${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  const example = brain.voice.examples[0];
  return (
    <div className="bb-voice">
      <p className="bb-big">{tone.replace(/;$/, ".")}</p>
      {more ? <p className="note">{more}</p> : null}
      {example ? (
        <blockquote className="bb-quote">“{example}”</blockquote>
      ) : null}
      <div className="bb-rules">
        <ul>
          {brain.voice.do.slice(0, 3).map((rule) => (
            <li key={`do:${rule}`}>
              <Check size={14} aria-hidden="true" className="rv-yes" />
              {rule}
            </li>
          ))}
        </ul>
        <ul>
          {brain.voice.dont.slice(0, 3).map((rule) => (
            <li key={`dont:${rule}`}>
              <X size={14} aria-hidden="true" className="rv-no" />
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type CustomerQuote = NonNullable<BrandBrain["voiceOfCustomer"]>[number];

const QUOTE_KINDS: Record<CustomerQuote["kind"], string> = {
  pain: "What hurts",
  trigger: "Why they looked",
  outcome: "What they got",
  objection: "What held them back",
};

/** Customers' exact words, the source of Cuso's hooks and ad headlines. */
export function CustomerWords({
  quotes,
}: {
  quotes: readonly CustomerQuote[];
}) {
  if (quotes.length === 0) return null;
  return (
    <div className="bb-competitors">
      <p className="label">In your customers' words</p>
      <ul className="bb-words">
        {quotes.map((quote) => (
          <li key={quote.quote}>
            <span className="label">{QUOTE_KINDS[quote.kind]}</span>
            <blockquote className="bb-quote">“{quote.quote}”</blockquote>
            {quote.sourceUrl ? (
              <a
                className="note"
                href={quote.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {sourceHost(quote.sourceUrl)}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

const RIVAL_FACTS = [
  ["promise", "Promises"],
  ["price", "Starts at"],
  ["strength", "Loved for"],
  ["weakness", "Complaints"],
] as const;

/** The closest competitors as Cuso read them: their promise, price and reviews. */
export function RivalFacts({
  competitors,
}: {
  competitors: BrandBrain["competitors"];
}) {
  const read = competitors.filter((competitor) =>
    RIVAL_FACTS.some(([key]) => competitor[key]),
  );
  if (read.length === 0) return null;
  return (
    <ul className="bb-rival-facts">
      {read.map((competitor) => (
        <li key={competitor.name}>
          <b>{competitor.name}</b>
          <dl>
            {RIVAL_FACTS.map(([key, label]) =>
              competitor[key] ? (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{competitor[key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </li>
      ))}
    </ul>
  );
}

const NETWORK_NAMES: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  github: "GitHub",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  threads: "Threads",
  discord: "Discord",
  newsletter: "Newsletter",
  blog: "Blog",
  website: "Website",
};

/** A pasted profile link as an account: "x.com/calcom" → X, https://x.com/calcom. */
export function accountFromLink(
  link: string,
): BrandBrain["channels"][number] | null {
  const text = link.trim();
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!url.hostname.includes(".")) return null;
    return {
      name: NETWORK_NAMES[channelKey("", url.href)] ?? "Website",
      url: url.href,
    };
  } catch {
    return null;
  }
}

interface AccountsProps {
  brain: BrandBrain;
  onSave: (brain: BrandBrain) => Promise<void>;
}

/** The accounts Cuso found, and the owner's own additions. */
export function Accounts({ brain, onSave }: AccountsProps) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The list changes on the tap; the save follows.
  const [channels, showChannels] = useOptimistic(
    brain.channels,
    (_shown, next: BrandBrain["channels"]) => next,
  );
  const [, startSaving] = useTransition();
  const save = (next: BrandBrain["channels"]) =>
    new Promise<void>((resolve) =>
      startSaving(async () => {
        setError(null);
        showChannels(next);
        try {
          await onSave({ ...brain, channels: next });
        } catch {
          setError("That didn't save. Try again.");
        }
        resolve();
      }),
    );
  return (
    <div className="bb-accounts">
      <p className="note">
        Where your business shows up today. These are links so {AGENT_NAME}{" "}
        knows your voice; you connect accounts for posting later.
      </p>
      {channels.length > 0 ? (
        <ul className="bb-account-list">
          {channels.map((channel) => (
            <li key={`${channel.name}:${channel.url ?? ""}`}>
              <ChannelIcon
                channel={channelKey(channel.name, channel.url)}
                size={18}
              />
              <b>{channel.name}</b>
              {channel.url ? (
                <a href={channel.url} target="_blank" rel="noreferrer">
                  {sourceHost(channel.url)}
                </a>
              ) : (
                <span className="note">No link</span>
              )}
              <button
                type="button"
                className="bb-remove"
                aria-label={`Remove ${channel.name}`}
                onClick={() =>
                  save(channels.filter((item) => item !== channel))
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">{AGENT_NAME} found no profiles yet.</p>
      )}
      {channels.length < 12 ? (
        <form
          className="bp-ask"
          action={async () => {
            const account = accountFromLink(link);
            if (!account) {
              setError(
                "Paste a link to the profile, like linkedin.com/company/you.",
              );
              return;
            }
            await save([...channels, account]);
            setLink("");
          }}
        >
          <input
            aria-label={`Add an account ${AGENT_NAME} missed`}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="Missing one? Paste the link"
          />
          <SubmitButton className="button button-secondary button-small">
            <Plus size={14} aria-hidden="true" />
            Add
          </SubmitButton>
        </form>
      ) : null}
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "linkedin.com/company/x" → "linkedin", for the icon. */
function channelKey(name: string, url?: string): string {
  const text = `${name} ${url ?? ""}`.toLowerCase();
  for (const key of [
    "linkedin",
    "instagram",
    "facebook",
    "youtube",
    "tiktok",
    "github",
    "bluesky",
    "mastodon",
    "threads",
    "discord",
  ]) {
    if (text.includes(key)) return key;
  }
  if (/bsky\.app/.test(text)) return "bluesky";
  if (/\bx\b|twitter|x\.com/.test(text)) return "x";
  if (/newsletter|email|substack/.test(text)) return "newsletter";
  if (/blog/.test(text)) return "blog";
  return "website";
}

/** The month the owner confirmed something, for the finding's date. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function SectionEditor({
  section,
  onSave,
  onCancel,
}: {
  section: BrandSection;
  onSave: (section: BrandSection) => Promise<void>;
  onCancel: () => void;
}) {
  const [headline, setHeadline] = useState(section.headline ?? "");
  const [answer, setAnswer] = useState(section.answer);
  const [findings, setFindings] = useState(section.findings);
  const [error, setError] = useState<string | null>(null);
  const headlineId = useId();
  const answerId = useId();

  return (
    <form
      className="bp-editor"
      action={async () => {
        const kept = findings.filter((finding) => finding.point.trim());
        if (!answer.trim()) {
          setError("The answer can't be empty.");
          return;
        }
        try {
          await onSave({
            ...section,
            headline: headline.trim() || undefined,
            answer: answer.trim(),
            findings: kept,
          });
        } catch {
          setError("That didn't save. Try again.");
        }
      }}
    >
      <label className="label" htmlFor={headlineId}>
        Headline
      </label>
      <input
        id={headlineId}
        value={headline}
        maxLength={80}
        onChange={(event) => setHeadline(event.target.value)}
      />
      <label className="label" htmlFor={answerId}>
        Answer
      </label>
      <textarea
        id={answerId}
        rows={2}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
      />
      <p className="label">Findings</p>
      <ul className="bp-edit-findings">
        {findings.map((finding, index) => (
          // Points change as they are typed; their place in the list does not.
          <li key={index}>
            <textarea
              rows={2}
              aria-label={`Finding ${index + 1}`}
              value={finding.point}
              onChange={(event) =>
                setFindings((current) =>
                  current.map((item, at) =>
                    at === index
                      ? ownerFinding(item, event.target.value)
                      : item,
                  ),
                )
              }
            />
            <button
              type="button"
              className="button button-ghost button-small"
              aria-label={`Remove finding ${index + 1}`}
              onClick={() =>
                setFindings((current) =>
                  current.filter((_, at) => at !== index),
                )
              }
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {findings.length < 6 ? (
        <button
          type="button"
          className="button button-ghost button-small bp-add"
          onClick={() =>
            setFindings((current) => [...current, ownerFinding(null, "")])
          }
        >
          <Plus size={14} aria-hidden="true" />
          Add a finding
        </button>
      ) : null}
      <p className="note">What you write here counts as a confirmed fact.</p>
      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="bp-editor-actions">
        <SubmitButton className="button button-small">Save</SubmitButton>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** An owner-written finding is a fact they confirmed, dated today. */
export function ownerFinding(
  finding: BrandFinding | null,
  point: string,
): BrandFinding {
  return {
    ...finding,
    point,
    evidence: "fact",
    confidence: "high",
    sourceUrl: undefined,
    asOf: thisMonth(),
  };
}

export function AskForm({
  cta,
  placeholder,
  optional = false,
  autoFocus = false,
  inputId,
  sentNote = `Sent. ${AGENT_NAME} updates the Brand Brain in about half a minute.`,
  onAsk,
  onCancel,
}: {
  cta: string;
  placeholder: string;
  optional?: boolean;
  autoFocus?: boolean;
  /** Ties the input to a visible label, which then names it. */
  inputId?: string;
  sentNote?: string;
  onAsk: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  if (state === "sent") {
    return (
      <p className="bp-sent" aria-live="polite">
        <Check size={14} aria-hidden="true" />
        {sentNote}
      </p>
    );
  }
  return (
    <form
      className="bp-ask"
      action={async () => {
        const value = text.trim();
        if (!value && !optional) return;
        try {
          await onAsk(value);
          setState("sent");
        } catch {
          setState("failed");
        }
      }}
    >
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        id={inputId}
        placeholder={placeholder}
        aria-label={inputId ? undefined : placeholder}
        autoFocus={autoFocus}
      />
      <SubmitButton className="button button-secondary button-small">
        {cta}
      </SubmitButton>
      {onCancel ? (
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={onCancel}
        >
          Cancel
        </button>
      ) : null}
      {state === "failed" ? (
        <p className="alert" role="alert">
          That didn't send. Try again.
        </p>
      ) : null}
    </form>
  );
}
