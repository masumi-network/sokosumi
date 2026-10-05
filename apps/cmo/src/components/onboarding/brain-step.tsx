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
import { ChannelIcon } from "../channel-icon";
import { BusinessMark, businessDisplayName } from "./flow";

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
  ]) {
    if (text.includes(key)) return key;
  }
  if (/\bx\b|twitter|x\.com/.test(text)) return "x";
  if (/newsletter|email/.test(text)) return "newsletter";
  return "website";
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
  const updating = overview.botStatus === "RUNNING";
  const [correction, setCorrection] = useState("");
  const [sending, startSending] = useTransition();
  const [planning, startPlanning] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const lastWord = [...messages].reverse().find((message) => message.fromCuso);

  return (
    <section className="ob-brain">
      <motion.div className="ob-brand-hero" {...reveal(0)}>
        <BusinessMark overview={overview} size={56} />
        <div className="ob-brand-id">
          <p className="ob-eyebrow">Brand Brain</p>
          <h1 className="ob-title">{businessDisplayName(overview)}</h1>
          <a
            className="ob-link"
            href={overview.websiteUrl}
            target="_blank"
            rel="noreferrer"
          >
            {overview.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
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
                  <span>{channel.name}</span>
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
            await onCorrect(
              `Correction to the Brand Brain: ${text}. Update it with save_brand_brain.`,
            );
            setCorrection("");
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
          disabled={sending || updating}
        />
        <button
          type="submit"
          className="ob-button ob-button-quiet"
          disabled={sending || updating || !correction.trim()}
        >
          {sending || updating ? (
            <>
              <Loader2 size={14} className="ob-spin" aria-hidden="true" />
              Updating
            </>
          ) : (
            "Fix it"
          )}
        </button>
      </motion.form>
      {updating && lastWord ? null : lastWord && !updating ? (
        <p className="ob-note ob-cuso-said">Cuso: {lastWord.content}</p>
      ) : null}

      <div className="ob-footer">
        <p className="ob-note">
          Next, Cuso plans the next four weeks around this.
        </p>
        <button
          type="button"
          className="ob-button ob-button-lg"
          disabled={planning || updating}
          onClick={() =>
            startPlanning(async () => {
              setRefusal(await onPlan());
            })
          }
        >
          {planning ? "Starting…" : "Looks right, plan my month"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        {refusal ? (
          <p className="ob-note" role="alert">
            {/credits/i.test(refusal)
              ? "You're out of credits. Top up on Sokosumi, then try again."
              : refusal}
          </p>
        ) : null}
      </div>
    </section>
  );
}
