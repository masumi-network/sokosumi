"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  ExternalLink,
  Loader2,
  PenLine,
  Quote,
} from "lucide-react";
import { motion } from "motion/react";
import { useState, useTransition } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import { BusinessMark, businessDisplayName } from "../business-mark";
import { ChannelIcon } from "../channel-icon";
import { Refusal } from "./refusal";

type BrandBrain = NonNullable<CmoOverview["brandBrain"]>;

const reveal = (index: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: 0.35,
    delay: 0.06 * index,
    ease: [0.25, 1, 0.5, 1] as const,
  },
});

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

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "https://x.com/plausiblehq" → "@plausiblehq"; a site → its host. */
function handleOf(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const first = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (!first || /^(company|in|channel|c|user)$/.test(first)) return host;
    return first.startsWith("@") ? first : `@${first}`;
  } catch {
    return url;
  }
}

interface BrainStepProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onCorrect: (text: string) => Promise<void>;
  onPlan: () => Promise<string | null>;
}

/** What Cuso learned, as the founder's brand: logo, colours, voice, market. */
export function BrainStep({
  overview,
  messages,
  onCorrect,
  onPlan,
}: BrainStepProps) {
  const brain = overview.brandBrain as BrandBrain;
  const visual = overview.brandVisual;
  const [correction, setCorrection] = useState("");
  const [sent, setSent] = useState<{
    text: string;
    /** Cuso's last message when it was sent; a new one is his answer. */
    after: string | null;
  } | null>(null);
  const [sending, startSending] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const lastWord = [...messages].reverse().find((message) => message.fromCuso);
  // A correction is applied once Cuso answers after it; until then the
  // founder sees what they asked for and that he is on it.
  const answered =
    sent !== null && lastWord !== undefined && lastWord.id !== sent.after;
  const fixing = sending || (sent !== null && !answered);
  // Right after research Cuso is still wrapping up his turn for a few seconds.
  const finishing = !fixing && overview.botStatus === "RUNNING";

  return (
    <section className="ob-brain">
      <motion.div className="ob-brand-hero" {...reveal(0)}>
        <BusinessMark overview={overview} size={56} wide />
        <div className="ob-brand-id">
          <p className="ob-eyebrow">Brand Brain</p>
          <h1 className="ob-title">{businessDisplayName(overview)}</h1>
          <a
            className="ob-link"
            href={overview.websiteUrl}
            target="_blank"
            rel="noreferrer"
          >
            {new URL(overview.websiteUrl).hostname.replace(/^www\./, "")}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
        {visual && (visual.colors.length > 0 || visual.fonts.length > 0) ? (
          <div className="ob-brand-look">
            <div className="ob-swatches">
              {visual.colors.map((color) => (
                <span
                  key={color}
                  className="ob-swatch"
                  style={{ background: color }}
                  title={color}
                >
                  <span className="ob-swatch-hex">{color}</span>
                </span>
              ))}
            </div>
            {visual.fonts.length > 0 ? (
              <p className="ob-note">Type: {visual.fonts.join(", ")}</p>
            ) : null}
          </div>
        ) : null}
      </motion.div>

      <motion.p className="ob-summary" {...reveal(1)}>
        {brain.summary}
      </motion.p>

      <div className="ob-grid">
        <motion.article className="ob-card" {...reveal(2)}>
          <h2>What you sell</h2>
          <ul className="ob-list">
            {brain.products.map((product) => (
              <li key={product}>{product}</li>
            ))}
          </ul>
        </motion.article>
        <motion.article className="ob-card" {...reveal(3)}>
          <h2>Who buys it</h2>
          <ul className="ob-list">
            {brain.audience.map((audience) => (
              <li key={audience}>{audience}</li>
            ))}
          </ul>
        </motion.article>
        <motion.article className="ob-card ob-card-wide" {...reveal(4)}>
          <h2>How you sound</h2>
          <p className="ob-tone">{brain.voice.tone}</p>
          {brain.voice.examples[0] ? (
            <blockquote className="ob-quote">
              <Quote size={14} aria-hidden="true" />
              {brain.voice.examples[0]}
            </blockquote>
          ) : null}
          <div className="ob-dos">
            <div>
              <p className="ob-label">Always</p>
              <ul className="ob-list">
                {brain.voice.do.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="ob-label">Never</p>
              <ul className="ob-list">
                {brain.voice.dont.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </motion.article>
        <motion.article className="ob-card" {...reveal(5)}>
          <h2>Who you compete with</h2>
          <div className="ob-chips">
            {brain.competitors.map((competitor) =>
              competitor.url ? (
                <a
                  key={competitor.name}
                  className="ob-chip"
                  href={competitor.url}
                  target="_blank"
                  rel="noreferrer"
                  title={competitor.note}
                >
                  {competitor.name}
                </a>
              ) : (
                <span
                  key={competitor.name}
                  className="ob-chip"
                  title={competitor.note}
                >
                  {competitor.name}
                </span>
              ),
            )}
          </div>
        </motion.article>
        <motion.article className="ob-card" {...reveal(6)}>
          <h2>Where you are today</h2>
          {brain.channels.length === 0 ? (
            <p className="ob-note">No channels found yet.</p>
          ) : (
            <ul className="ob-channels">
              {brain.channels.map((channel) => (
                <li key={channel.name}>
                  <ChannelIcon
                    channel={channelKey(channel.name, channel.url)}
                  />
                  {channel.url ? (
                    <a
                      className="ob-channel-link"
                      href={channel.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{capitalized(channel.name)}</span>
                      <span className="ob-note">{handleOf(channel.url)}</span>
                    </a>
                  ) : (
                    <span>{capitalized(channel.name)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </motion.article>
      </div>

      <motion.form
        className="ob-correct"
        {...reveal(7)}
        onSubmit={(event) => {
          event.preventDefault();
          const text = correction.trim();
          if (!text) return;
          startSending(async () => {
            setSent({ text, after: lastWord?.id ?? null });
            try {
              await onCorrect(`Fix in my Brand Brain: ${text}`);
              setCorrection("");
            } catch {
              setSent(null);
              setRefusal("That didn't send. Try again.");
            }
          });
        }}
      >
        <PenLine size={16} aria-hidden="true" />
        <input
          className="ob-inline-input"
          value={correction}
          onChange={(event) => setCorrection(event.target.value)}
          placeholder="Something off? Tell Cuso, e.g. “we sell to CTOs, not founders”"
          aria-label="Correct the Brand Brain"
          disabled={fixing}
        />
        <button
          type="submit"
          className="ob-button ob-button-quiet"
          disabled={fixing || !correction.trim()}
        >
          {fixing ? (
            <>
              <Loader2 size={14} className="ob-spin" aria-hidden="true" />
              Updating
            </>
          ) : (
            "Fix it"
          )}
        </button>
      </motion.form>
      {sent ? (
        <div className="ob-exchange" aria-live="polite">
          <p className="ob-note">You: {sent.text}</p>
          <p className="ob-note ob-cuso-said">
            {answered && lastWord
              ? `Cuso: ${lastWord.content}`
              : "Cuso is updating your Brand Brain. This takes about half a minute."}
          </p>
        </div>
      ) : null}

      <div className="ob-footer">
        <p className="ob-note">
          Next, Cuso plans the next four weeks around this.
        </p>
        <button
          type="button"
          className="ob-button ob-button-lg"
          disabled={planning || fixing || finishing}
          onClick={() =>
            startPlanning(async () => {
              setRefusal(await onPlan());
            })
          }
        >
          {planning ? (
            "Starting…"
          ) : fixing || finishing ? (
            <>
              <Loader2 size={16} className="ob-spin" aria-hidden="true" />
              {fixing ? "Cuso is updating" : "Cuso is finishing up"}
            </>
          ) : (
            <>
              Looks right, plan my month
              <ArrowRight size={16} aria-hidden="true" />
            </>
          )}
        </button>
        {refusal ? (
          <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
        ) : null}
      </div>
    </section>
  );
}
