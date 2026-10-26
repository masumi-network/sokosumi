"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  MessageSquare,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  BRAND_GROUPS,
  BRAND_SECTIONS,
  type BrandBrain,
  type BrandFinding,
  type BrandSection,
  type BrandSectionKey,
  brandProfile,
  EVIDENCE_LABELS,
  formatAsOf,
  openQuestions,
  sourceHost,
} from "../lib/brand-sections";
import { BusinessMark, businessDisplayName } from "./business-mark";
import { ChannelIcon } from "./channel-icon";
import { SubmitButton } from "./submit-button";

const EASE = [0.25, 1, 0.5, 1] as const;
const ALL_KEYS = BRAND_GROUPS.flatMap((group) => group.keys);

type Open = BrandSectionKey | "questions" | null;

interface BrandRevealProps {
  overview: CmoOverview;
  /** The first look after research: the sections arrive one by one. */
  intro?: boolean;
  /** Says what the Brand Brain is; setup lets Cuso say it instead. */
  explain?: boolean;
  /** Saves the owner's own edit straight away. */
  onSave: (brain: BrandBrain) => Promise<void>;
  /** Hands a change or an answer to Cuso, who updates the Brand Brain. */
  onAsk: (text: string) => Promise<void>;
}

/**
 * The Brand Brain, answer first: what the business does in one line, then
 * who buys, how it sounds, where it posts and who it competes with. The full
 * research sits one click deeper.
 */
export function BrandReveal({
  overview,
  intro = false,
  explain = true,
  onSave,
  onAsk,
}: BrandRevealProps) {
  const brain = overview.brandBrain as BrandBrain;
  const profile = brandProfile(brain);
  const reveal = brain.reveal;
  const reduce = useReducedMotion();
  const play = intro && !reduce;
  const [open, setOpen] = useState<Open>(null);
  const [all, setAll] = useState(false);
  const [redo, setRedo] = useState(false);
  const questions = openQuestions(profile);
  const researched = ALL_KEYS.filter((key) => profile[key]).length;
  /** Each section arrives a beat after the one above on the first look. */
  const beat = (at: number) =>
    play
      ? {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay: 0.2 + at * 0.12, ease: EASE },
        }
      : {};

  return (
    <div className="bb" style={brandStyle(overview)}>
      <motion.header className="bb-hero" {...beat(0)}>
        <div className="bb-id">
          <BusinessMark overview={overview} size={40} wide />
          <div>
            <p className="bb-name">{businessDisplayName(overview)}</p>
            <a href={overview.websiteUrl} target="_blank" rel="noreferrer">
              {hostOf(overview.websiteUrl)}
            </a>
          </div>
        </div>
        {explain ? (
          <p className="bb-eyebrow">
            Your Brand Brain: what Cuso learned about your business. Everything
            he writes follows it.
          </p>
        ) : null}
        <h1 className="bb-line">
          {reveal?.positioning ?? firstSentence(brain.summary)}
        </h1>
        {reveal?.positioning ? (
          <p className="bb-lede">{firstSentence(brain.summary)}</p>
        ) : null}
      </motion.header>

      {researched === 0 ? (
        <motion.div className="bb-callout" {...beat(1)}>
          <p>
            <b>This is the short version.</b> Cuso can look deeper: customers,
            pricing, competitors, reviews and more, each with a source. It takes
            about three minutes.
          </p>
          <AskForm
            cta="Look deeper"
            placeholder="Anything Cuso should know first? (optional)"
            optional
            sentNote={RESEARCH_SENT}
            onAsk={(text) => onAsk(researchRequest(text))}
          />
        </motion.div>
      ) : null}

      {questions.length > 0 ? (
        <motion.button
          type="button"
          className="bb-callout bb-callout-button"
          onClick={() => setOpen("questions")}
          {...beat(1)}
        >
          <span>
            <b>
              Cuso has {questions.length}{" "}
              {questions.length === 1 ? "question" : "questions"}.
            </b>{" "}
            A line each makes your plan better.
          </span>
          <span className="bb-link">
            Answer <ArrowRight size={14} aria-hidden="true" />
          </span>
        </motion.button>
      ) : null}

      <Section title="What you sell" beat={beat(2)}>
        <Offers brain={brain} />
      </Section>

      <Section title="Who buys" beat={beat(3)}>
        {reveal && reveal.buyers.length > 0 ? (
          <ul className="bb-list">
            {reveal.buyers.map((buyer) => (
              <li key={buyer.role}>
                <b>{buyer.role}</b>
                <span>Wants: {lowerFirst(buyer.wants)}</span>
                <span className="note">Worries: {lowerFirst(buyer.worry)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bb-big">{brain.audience.join(", ")}</p>
        )}
      </Section>

      <Section title="Tone of voice" beat={beat(4)}>
        <Voice brain={brain} />
      </Section>

      <Section title="Profiles we found" beat={beat(5)}>
        <Accounts brain={brain} onSave={onSave} />
      </Section>

      {reveal?.map ||
      brain.competitors.length > 0 ||
      (brain.alternatives ?? []).length > 0 ? (
        <Section title="Competitors" beat={beat(6)}>
          {reveal?.map ? (
            <MarketMap map={reveal.map} competitors={brain.competitors} />
          ) : null}
          <ul className="bb-list bb-competitors">
            {brain.competitors.map((competitor) => (
              <li key={competitor.name}>
                {competitor.url ? (
                  <a href={competitor.url} target="_blank" rel="noreferrer">
                    <b>{competitor.name}</b>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                ) : (
                  <b>{competitor.name}</b>
                )}
                {competitor.note ? <span>{competitor.note}</span> : null}
              </li>
            ))}
          </ul>
          {(brain.alternatives ?? []).length > 0 ? (
            <p className="bb-alternatives">
              <span className="label">Also compared with</span>
              {(brain.alternatives ?? []).map((alternative) =>
                alternative.url ? (
                  <a
                    key={alternative.name}
                    href={alternative.url}
                    target="_blank"
                    rel="noreferrer"
                    title={alternative.note}
                  >
                    {alternative.name}
                  </a>
                ) : (
                  <span key={alternative.name} title={alternative.note}>
                    {alternative.name}
                  </span>
                ),
              )}
            </p>
          ) : null}
        </Section>
      ) : null}

      {reveal && reveal.insights.length > 0 ? (
        <Section title="What Cuso noticed" beat={beat(7)}>
          <ol className="bb-list bb-numbered">
            {reveal.insights.map((insight) => (
              <li key={insight.title}>
                <b>{insight.title}</b>
                <span>{insight.detail}</span>
                {insight.sourceUrl ? (
                  <a
                    className="note"
                    href={insight.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {sourceHost(insight.sourceUrl)}
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {researched > 0 ? (
        <motion.div className="bb-more" {...beat(7)}>
          <button
            type="button"
            className="bb-toggle"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? "Hide the research" : "See the research"}
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {all ? (
            <div className="bb-all">
              {BRAND_GROUPS.map((group) => (
                <section key={group.title} className="rv-group">
                  <h3 className="label">{group.title}</h3>
                  <div className="rv-tiles">
                    {group.keys.map((key) => (
                      <Tile
                        key={key}
                        sectionKey={key}
                        section={profile[key]}
                        onOpen={() => setOpen(key)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {redo ? (
                <AskForm
                  cta="Look again"
                  placeholder="What changed? (optional)"
                  optional
                  autoFocus
                  sentNote={RESEARCH_SENT}
                  onAsk={(text) => onAsk(researchRequest(text))}
                  onCancel={() => setRedo(false)}
                />
              ) : (
                <button
                  type="button"
                  className="bb-toggle"
                  onClick={() => setRedo(true)}
                >
                  Research again
                </button>
              )}
            </div>
          ) : null}
        </motion.div>
      ) : null}

      <AnimatePresence>
        {open === "questions" ? (
          <SideSheet
            key="questions"
            label="Questions for you"
            onClose={() => setOpen(null)}
          >
            <h3 className="sheet-title">Questions for you</h3>
            <ul className="rv-question-list">
              {questions.map(({ key, question }) => (
                <li key={`${key}:${question}`}>
                  <p className="label">{BRAND_SECTIONS[key].title}</p>
                  <p>{question}</p>
                  <AskForm
                    cta="Answer"
                    placeholder="Your answer"
                    onAsk={(answer) =>
                      onAsk(
                        `Answer for my Brand Brain, ${BRAND_SECTIONS[key].title}: “${question}” ${answer}`,
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </SideSheet>
        ) : open ? (
          <SectionSheet
            key={open}
            sectionKey={open}
            section={profile[open]}
            onClose={() => setOpen(null)}
            onSave={async (section) => {
              await onSave({
                ...brain,
                profile: { ...profile, [open]: section },
              });
              // The summary above comes from Cuso, so he brings it in line.
              await onAsk(
                `I corrected the ${BRAND_SECTIONS[open].title} research in my Brand Brain. Update the summary to match it.`,
              );
            }}
            onAsk={onAsk}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** One idea: its name on the left, the answer on the right. */
/**
 * What the business sells and what it costs, the main offer first: every
 * plan is built on it. Older Brand Brains only name their products.
 */
function Offers({ brain }: { brain: BrandBrain }) {
  const offers = brain.offers ?? [];
  if (offers.length === 0) {
    return <p className="bb-big">{brain.products.join(", ")}</p>;
  }
  return (
    <ul className="bb-offers">
      {offers.map((offer) => (
        <li key={offer.name} className="bb-offer">
          <div className="bb-offer-head">
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
        </li>
      ))}
    </ul>
  );
}

export function Section({
  title,
  beat,
  wide = false,
  children,
}: {
  title: string;
  beat?: object;
  /** Takes the full width under its name, for calendars and previews. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.section
      className={wide ? "bb-section wide" : "bb-section"}
      {...beat}
    >
      <h2 className="bb-title">{title}</h2>
      <div className="bb-body">{children}</div>
    </motion.section>
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
 * The brand's accent: the site's own first colour when it is a real colour,
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

/** The brand's accent and a soft fill of it. */
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The first sentence, for a Brand Brain written before positioning existed. */
function firstSentence(text: string): string {
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  return match ? match[0] : text;
}

type Reveal = NonNullable<BrandBrain["reveal"]>;

function MarketMap({
  map,
  competitors,
}: {
  map: NonNullable<Reveal["map"]>;
  competitors: BrandBrain["competitors"];
}) {
  const links = new Map(
    competitors.map((competitor) => [
      competitor.name.toLowerCase(),
      competitor.url,
    ]),
  );
  return (
    <div className="rv-map">
      <div className="rv-plot">
        <span className="rv-axis top">↑ {map.y.high}</span>
        <span className="rv-axis bottom">{map.y.low}</span>
        {map.players.map((player) => {
          const url = player.you
            ? undefined
            : links.get(player.name.toLowerCase());
          const Dot = url ? "a" : "span";
          return (
            <Dot
              key={player.name}
              {...(url
                ? { href: url, target: "_blank", rel: "noreferrer" }
                : {})}
              className={[
                "rv-dot",
                player.you ? "you" : "",
                player.x > 75 ? "flip" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${player.x}%`, bottom: `${player.y}%` }}
            >
              <i aria-hidden="true" />
              {player.name}
            </Dot>
          );
        })}
      </div>
      <div className="rv-xaxis">
        <span>{map.x.low}</span>
        <span>{map.x.high} →</span>
      </div>
    </div>
  );
}

/** "Clear, direct, practical. Explains the technical plainly." → its first sentence large. */
function Voice({ brain }: { brain: BrandBrain }) {
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

/** The accounts Cuso found, and the owner's own additions. */
function Accounts({
  brain,
  onSave,
}: {
  brain: BrandBrain;
  onSave: (brain: BrandBrain) => Promise<void>;
}) {
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async (next: BrandBrain["channels"]) => {
    setError(null);
    try {
      await onSave({ ...brain, channels: next });
    } catch {
      setError("That didn't save. Try again.");
    }
  };
  return (
    <div className="bb-accounts">
      <p className="note">
        Where your business shows up today. These are links so Cuso knows your
        voice; you connect accounts for posting later.
      </p>
      {brain.channels.length > 0 ? (
        <ul className="bb-account-list">
          {brain.channels.map((channel) => (
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
                  save(brain.channels.filter((item) => item !== channel))
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">Cuso found no profiles yet.</p>
      )}
      {brain.channels.length < 12 ? (
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
            await save([...brain.channels, account]);
            setLink("");
          }}
        >
          <input
            aria-label="Add an account Cuso missed"
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

function Tile({
  sectionKey,
  section,
  onOpen,
}: {
  sectionKey: BrandSectionKey;
  section: BrandSection | undefined;
  onOpen: () => void;
}) {
  const { question } = BRAND_SECTIONS[sectionKey];
  const asks = section?.openQuestions?.length ?? 0;
  return (
    <button
      type="button"
      className={section ? "rv-tile" : "rv-tile missing"}
      onClick={onOpen}
    >
      <span className="rv-tile-q">{question}</span>
      <span className="rv-tile-h">
        {section
          ? (section.headline ?? clip(section.answer, 72))
          : "Not researched yet"}
      </span>
      {section ? (
        <span className="rv-tile-meta">
          <span
            className="rv-dots"
            role="img"
            aria-label={evidenceSummary(section.findings)}
            title={evidenceSummary(section.findings)}
          >
            {section.findings.map((finding) => (
              <i key={finding.point} className={finding.evidence} />
            ))}
          </span>
          {asks > 0 ? (
            <span className="rv-tile-ask">
              {asks} {asks === 1 ? "question" : "questions"}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function SideSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // Focus moves into the panel, stays there, and returns where it came from.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    close.current?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input, textarea, select",
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      // A sent form unmounts its focused button; Tab brings focus back in.
      if (!panel.current.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {/* The sheet's Close button is its one control; the scrim only catches clicks. */}
      <motion.div
        className="sheet-scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        ref={panel}
        className="sheet rv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
      >
        <div className="sheet-head">
          <span className="label">{label}</span>
          <button
            ref={close}
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </motion.aside>
    </>
  );
}

function SectionSheet({
  sectionKey,
  section,
  onClose,
  onSave,
  onAsk,
}: {
  sectionKey: BrandSectionKey;
  section: BrandSection | undefined;
  onClose: () => void;
  onSave: (section: BrandSection) => Promise<void>;
  onAsk: (text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "research">("view");
  const { title, question } = BRAND_SECTIONS[sectionKey];
  return (
    <SideSheet label={title} onClose={onClose}>
      <h3 className="sheet-title">{question}</h3>
      {mode === "edit" && section ? (
        <SectionEditor
          section={section}
          onCancel={() => setMode("view")}
          onSave={async (next) => {
            await onSave(next);
            setMode("view");
          }}
        />
      ) : section ? (
        <>
          {section.headline ? (
            <p className="rv-sheet-headline">{section.headline}</p>
          ) : null}
          <p>{section.answer}</p>
          {section.findings.length > 0 ? (
            <>
              <p className="label">{evidenceSummary(section.findings)}</p>
              <ul className="bp-findings">
                {section.findings.map((finding) => (
                  <Finding key={finding.point} finding={finding} />
                ))}
              </ul>
            </>
          ) : null}
          {(section.openQuestions ?? []).map((open) => (
            <div key={open} className="rv-sheet-question">
              <p>{open}</p>
              <AskForm
                cta="Answer"
                placeholder="Your answer"
                onAsk={(answer) =>
                  onAsk(
                    `Answer for my Brand Brain, ${title}: “${open}” ${answer}`,
                  )
                }
              />
            </div>
          ))}
        </>
      ) : (
        <p className="note">Cuso has not researched this yet.</p>
      )}

      {section ? (
        mode === "view" ? (
          <div className="rv-sheet-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setMode("edit")}
            >
              <PenLine size={14} aria-hidden="true" />
              Edit
            </button>
          </div>
        ) : null
      ) : mode === "research" ? (
        <AskForm
          cta="Send"
          placeholder="Anything Cuso should know? (optional)"
          optional
          autoFocus
          onCancel={() => setMode("view")}
          onAsk={(text) =>
            onAsk(
              `Research the ${title} section of my Brand Brain and save it.${text ? ` ${text}` : ""}`,
            )
          }
        />
      ) : (
        <div className="rv-sheet-actions">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setMode("research")}
          >
            <MessageSquare size={14} aria-hidden="true" />
            Research this
          </button>
        </div>
      )}
    </SideSheet>
  );
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

/** "3 findings · 2 facts, 1 claim". */
function evidenceSummary(findings: BrandFinding[]): string {
  const count = (evidence: BrandFinding["evidence"]) =>
    findings.filter((finding) => finding.evidence === evidence).length;
  const parts = [
    [count("fact"), "fact", "facts"],
    [count("claim"), "claim", "claims"],
    [count("inference"), "read", "reads"],
  ] as const;
  const kinds = parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  const total = `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`;
  return [total, kinds.join(", ")].filter(Boolean).join(" · ");
}

function Finding({ finding }: { finding: BrandFinding }) {
  const meta = [
    `${finding.confidence} confidence`,
    finding.asOf ? formatAsOf(finding.asOf) : null,
  ].filter(Boolean);
  return (
    <li className="bp-finding">
      <span className={`bp-evidence ${finding.evidence}`}>
        {EVIDENCE_LABELS[finding.evidence]}
      </span>
      <div className="bp-finding-body">
        <p>{finding.point}</p>
        {finding.implication ? (
          <p className="bp-so">
            <span>So</span>
            {finding.implication}
          </p>
        ) : null}
        <p className="bp-meta">
          {meta.join(" · ")}
          {finding.sourceUrl ? (
            <>
              {" · "}
              <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
                {sourceHost(finding.sourceUrl)}
              </a>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/** The month the owner confirmed something, for the finding's date. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function SectionEditor({
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

const RESEARCH_SENT =
  "Sent. Cuso is researching; sections fill in here over the next few minutes.";

function researchRequest(note: string): string {
  return `Research my business again from scratch: re-read my site, customers, market and competitors, rewrite every Brand Brain section, then save the essentials and the reveal.${note ? ` ${note}` : ""}`;
}

export function AskForm({
  cta,
  placeholder,
  optional = false,
  autoFocus = false,
  sentNote = "Sent. Cuso updates the Brand Brain in about half a minute.",
  onAsk,
  onCancel,
}: {
  cta: string;
  placeholder: string;
  optional?: boolean;
  autoFocus?: boolean;
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
        placeholder={placeholder}
        aria-label={placeholder}
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
