"use client";

import "./onboarding.css";
import type { CmoBrandMedia, CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  BRAND_SECTIONS,
  type BrandBrain,
  type BrandSection,
  type BrandSectionKey,
  brandProfile,
  EVIDENCE_LABELS,
  sourceHost,
} from "../../lib/brand-sections";
import { channelLabel } from "../../lib/calendar";
import { channelKey } from "../../lib/channels";
import type { CusoMessage } from "../../lib/chat-messages";
import { joinNames } from "../../lib/names";
import { CompetitorCards, SiteShowcase } from "../brand-media";
import {
  Accounts,
  AskForm,
  CustomerWords,
  clip,
  firstSentence,
  hostOf,
  Offers,
  RivalFacts,
  SectionEditor,
  Voice,
} from "../brand-profile";
import { BusinessMark } from "../business-mark";
import { CusoAvatar } from "../cuso";
import { MarketingToday } from "../marketing-today";
import { SubmitButton } from "../submit-button";
import { TypeIn } from "../type-in";
import { planWriting, researchGroups, stepTitle } from "./live";
import { type Answer, QuestionCard, useAnswers } from "./questions";
import { Refusal } from "./refusal";
import { SidePanel, Tile } from "./tiles";

/** Brand colours the site card shows, at most. */
const MAX_COLORS = 5;

/** Insights "What I noticed" lists, at most. */
const MAX_INSIGHTS = 3;

/** Longest one-line value or detail a tile shows. */
const CLIP = 72;

const short = (text: string) => clip(text, CLIP);

interface TileData {
  id: string;
  label: string;
  value: string;
  detail?: string;
  /** The profile section behind it, with its findings and sources. */
  section?: BrandSectionKey;
  /** What the panel shows first, from the Brand Brain's own fields. */
  body?: ReactNode;
}

/**
 * Up to six tiles, in the order a founder reads their brand: what they sell,
 * who buys, how they sound, where marketing stands, who they compete with
 * and where they have profiles. Only those Cuso found data for.
 */
export function brandTiles(
  brain: BrandBrain,
  onSave: (brain: BrandBrain) => Promise<void>,
  media: CmoBrandMedia | null = null,
): TileData[] {
  const tiles: TileData[] = [];
  const offers = brain.offers ?? [];
  const offer = offers[0];
  // The product's name, else how many offers there are; the detail says more.
  const sells =
    brain.products[0] ??
    (offers.length > 0
      ? `${offers.length} ${offers.length === 1 ? "offer" : "offers"}`
      : undefined);
  if (sells) {
    tiles.push({
      id: "sell",
      label: "What you sell",
      value: short(sells),
      detail: offer
        ? short(
            // "Free" priced "Free, 250 credits per seat" reads once, not twice.
            `${offer.price.startsWith(offer.name) ? offer.price : `${offer.name}, ${offer.price}`}. ${offer.what}`,
          )
        : short(brain.products.slice(1).join(", ")),
      section: "offer",
      body: <Offers brain={brain} onSave={onSave} />,
    });
  }
  const buyer = brain.reveal?.buyers[0];
  const buys = buyer?.role ?? brain.audience[0];
  const quotes = brain.voiceOfCustomer ?? [];
  if (buys || quotes.length > 0) {
    tiles.push({
      id: "buy",
      label: "Who buys",
      value: short(buys ?? "Your buyers"),
      detail: buyer
        ? short(`Wants: ${buyer.wants}`)
        : short(brain.audience.slice(1).join(", ")),
      section: "customers",
      body: quotes.length > 0 ? <CustomerWords quotes={quotes} /> : undefined,
    });
  }
  if (brain.voice.tone) {
    tiles.push({
      id: "voice",
      label: "Your voice",
      value: short(firstSentence(brain.voice.tone)),
      detail: brain.voice.do[0] ? short(brain.voice.do[0]) : undefined,
      section: "positioning",
      body: <Voice brain={brain} />,
    });
  }
  const today = brain.marketingToday;
  if (today) {
    const names = (today.channels ?? []).map((channel) => {
      const key = channelKey(channel.name.toLowerCase().replace(/\s+/g, ""));
      return key ? channelLabel(key) : channel.name;
    });
    tiles.push({
      id: "marketing",
      label: "Marketing today",
      value:
        names.length === 0
          ? "Not much yet"
          : names.length > 3
            ? `${names.length} channels`
            : joinNames(names),
      detail: short(firstSentence(today.summary)),
      section: "marketing",
      body: <MarketingToday today={today} />,
    });
  }
  const rivals = [...brain.competitors, ...(brain.alternatives ?? [])];
  if (rivals.length > 0) {
    tiles.push({
      id: "competitors",
      label: "Competitors",
      value: `${rivals.length} compared`,
      detail: short(rivals.map((rival) => rival.name).join(", ")),
      section: "competition",
      body: (
        <>
          {media && media.competitors.length > 0 ? (
            <CompetitorCards brain={brain} media={media} />
          ) : (
            <ul className="ob-list">
              {rivals.map((rival) => (
                <li key={rival.name}>
                  {rival.url ? (
                    <a href={rival.url} target="_blank" rel="noreferrer">
                      {rival.name}
                    </a>
                  ) : (
                    rival.name
                  )}
                  {rival.note ? ` · ${rival.note}` : ""}
                </li>
              ))}
            </ul>
          )}
          <RivalFacts competitors={brain.competitors} />
        </>
      ),
    });
  }
  if (brain.channels.length > 0) {
    tiles.push({
      id: "profiles",
      label: "Profiles",
      value: `${brain.channels.length} ${brain.channels.length === 1 ? "profile" : "profiles"}`,
      detail: short(brain.channels.map((channel) => channel.name).join(", ")),
      body: <Accounts brain={brain} onSave={onSave} />,
    });
  }
  return tiles;
}

interface BrandStepProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onCorrect: (text: string) => Promise<void>;
  onSave: (brain: BrandBrain) => Promise<void>;
  /** Approves the Brand Brain and asks for the plan; a refusal comes back as text. Without it the step only shows the Brand Brain. */
  onApprove?: () => Promise<string | null>;
  /** Without it the open questions are not asked here. */
  onAnswer?: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  /** Set when the founder opened this step again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
  /** Renders the heading itself; the onboarding shell shows it instead. */
  titled?: boolean;
}

/** What Cuso learned, as the founder's brand: a promise, six tiles, a side panel. */
export function BrandStep({
  overview,
  messages,
  onCorrect,
  onSave,
  onApprove,
  onAnswer,
  ahead,
  titled = true,
}: BrandStepProps) {
  const brain = overview.brandBrain as BrandBrain;
  const profile = brandProfile(brain);
  const site = hostOf(overview.websiteUrl);
  const [open, setOpen] = useState<string | null>(null);
  const [sent, setSent] = useState<{
    text: string;
    /** Cuso's last message when it was sent; a new one is his answer. */
    after: string | null;
  } | null>(null);
  const [approving, startApproving] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const lastWord = [...messages].reverse().find((message) => message.fromCuso);
  // A correction is applied once Cuso answers after it; until then the
  // founder sees what they asked for and that he is on it.
  const answered =
    sent !== null && lastWord !== undefined && lastWord.id !== sent.after;
  // A turn that ended without a reply, or never answered, must not lock the
  // founder in: after a grace period the change counts as not done.
  // Each send is a new object, so a new send starts fresh.
  const [staleSent, setStaleSent] = useState<typeof sent>(null);
  const stale = sent !== null && staleSent === sent;
  const idle = overview.botStatus !== "RUNNING";
  useEffect(() => {
    if (sent === null || answered) return;
    const timer = window.setTimeout(
      () => setStaleSent(sent),
      idle ? 30_000 : 240_000,
    );
    return () => window.clearTimeout(timer);
  }, [sent, answered, idle]);
  const fixing = sent !== null && !answered && !stale;
  // Right after research Cuso is still wrapping up his turn for a few
  // seconds. The plan Core starts after it never holds the founder back.
  const writing = planWriting(overview);
  const finishing =
    !fixing && !stale && overview.botStatus === "RUNNING" && !writing;
  // The plan's slot: Core started it when the research ended, and it opens
  // once the founder confirms the brand.
  const planSlot =
    researchGroups(overview) !== null &&
    !overview.brandBrainConfirmedAt &&
    (writing || overview.strategy !== null);

  async function ask(text: string) {
    setSent({ text, after: lastWord?.id ?? null });
    try {
      await onCorrect(text);
    } catch (error) {
      setSent(null);
      throw error;
    }
  }

  const tiles = brandTiles(brain, onSave, overview.brandMedia);
  const shown = tiles.find((tile) => tile.id === open);
  const section = shown?.section ? profile[shown.section] : undefined;

  const [shownQuestions, answer] = useAnswers(
    brain.questions ?? [],
    onAnswer ?? (async () => {}),
  );
  const questions = onAnswer ? shownQuestions : [];
  const left = questions.filter((question) => !question.answer);
  const openQuestion = questions.findIndex((question) => !question.answer);
  const current = questions[openQuestion];
  // A no waits for Cuso to rewrite its section; opened again after the plan,
  // the founder sends him to fix it instead of moving on.
  const corrections = questions.filter(
    (question) => question.answer === "no" && question.corrected === false,
  ).length;
  const lead = corrections > 0 ? undefined : ahead;
  const hasShot = overview.brandMedia?.pages.some(
    (page) => page.device === "desktop" && page.label === "Home",
  );
  const insights = brain.reveal?.insights ?? [];
  const busy = approving || fixing || finishing;

  return (
    <section className="ob-brand">
      <div className="ob-title-row">
        <CusoAvatar pose="thinking" size={48} />
        <div className="ob-title-copy">
          {titled ? (
            <h1 className="ob-h1">{stepTitle({ step: "brand", overview })}</h1>
          ) : null}
          <p className="muted">
            {AGENT_NAME} · tap any tile to see the source or fix it
          </p>
        </div>
        <div className="ob-title-action">
          {lead ? (
            <button type="button" className="button" onClick={lead.onClick}>
              Continue to {lead.label}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : onApprove ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                startApproving(async () => {
                  try {
                    setRefusal(await onApprove());
                  } catch {
                    setRefusal(
                      "That didn't go through. Try again in a moment.",
                    );
                  }
                })
              }
            >
              {approving ? (
                "Starting…"
              ) : fixing || finishing ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                  {fixing ? `${AGENT_NAME} is updating` : "Finishing up"}
                </>
              ) : (
                <>
                  Looks like us
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
          ) : null}
          {fixing ? (
            <p className="ob-small muted">
              Updating your Brand Brain. About half a minute.
            </p>
          ) : stale && !answered ? (
            <p className="ob-small muted">
              That change didn't come through. Ask again, or approve this
              version.
            </p>
          ) : null}
        </div>
      </div>
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}

      <div className="panel ob-brand-panel">
        <div className="ob-brand-main">
          <div className={hasShot ? "ob-hero-row has-site" : "ob-hero-row"}>
            <PromiseCard brain={brain} site={site} onSave={onSave} />
            {hasShot ? <SiteCard overview={overview} host={site} /> : null}
          </div>

          {planSlot ? (
            <div className="card ob-plan-slot" aria-live="polite">
              <span className="ob-small muted">Your plan</span>
              <b>
                <TypeIn
                  text={writing ? "Writing your plan" : "Your plan is ready"}
                />
              </b>
              <span className="ob-small muted">
                It opens when you say Looks like us.
              </span>
            </div>
          ) : null}

          {left.length > 0 ? (
            <div className="card card-focus ob-left">
              <p>
                {left.length} {left.length === 1 ? "question" : "questions"}{" "}
                left
              </p>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setAsking(!asking)}
              >
                {asking ? "Hide them" : "Answer them"}
              </button>
            </div>
          ) : null}
          {asking && current ? (
            <QuestionCard
              key={current.id}
              topic={BRAND_SECTIONS[current.section].title}
              question={current}
              index={openQuestion}
              answered={questions.map((question) => Boolean(question.answer))}
              onAnswer={(value, note) => answer(current.id, value, note)}
            />
          ) : null}

          <div className="ob-tiles">
            {tiles.map((tile) => (
              <Tile
                key={tile.id}
                label={tile.label}
                value={tile.value}
                detail={tile.detail}
                source={`Source: ${sourceHost(tileSource(tile, profile, overview.websiteUrl))}`}
                open={open === tile.id}
                onToggle={() => setOpen(open === tile.id ? null : tile.id)}
              />
            ))}
          </div>

          {insights.length > 0 ? (
            <div className="card ob-noticed">
              <h2>What I noticed</h2>
              <ol>
                {insights.slice(0, MAX_INSIGHTS).map((insight) => (
                  <li key={insight.title}>
                    <b>{insight.title}</b>
                    <span>{insight.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>

        {shown ? (
          <SidePanel
            title={shown.label}
            onClose={() => setOpen(null)}
            source={`Source: ${sourceHost(tileSource(shown, profile, overview.websiteUrl))}`}
            sourceUrl={tileSource(shown, profile, overview.websiteUrl)}
          >
            <TileDetail
              key={shown.id}
              section={section}
              body={shown.body}
              onSave={
                shown.section
                  ? async (next) => {
                      if (!shown.section) return;
                      await onSave({
                        ...brain,
                        profile: { ...profile, [shown.section]: next },
                      });
                      // The summary comes from Cuso, so he brings it in line.
                      await ask(
                        `I corrected the ${BRAND_SECTIONS[shown.section].title} research in my Brand Brain. Update the summary to match it.`,
                      );
                    }
                  : undefined
              }
            />
            <div className="ob-ask-field">
              <label htmlFor="ob-tell">Tell {AGENT_NAME} what's off</label>
              <AskForm
                key={shown.id}
                inputId="ob-tell"
                cta="Send"
                placeholder="Say what to fix"
                onAsk={ask}
              />
            </div>
            {sent && answered && lastWord ? (
              <p className="note" aria-live="polite">
                {AGENT_NAME}: {lastWord.content}
              </p>
            ) : null}
          </SidePanel>
        ) : null}
      </div>
    </section>
  );
}

interface TileDetailProps {
  section: BrandSection | undefined;
  /** What the Brand Brain's own fields show, such as the offers or the voice. */
  body: ReactNode;
  /** Saves the owner's edit of the section; unset where it has none. */
  onSave: ((section: BrandSection) => Promise<void>) | undefined;
}

/** One short summary, the Brand Brain's own fields, then the findings in rows. */
function TileDetail({ section, body, onSave }: TileDetailProps) {
  const [editing, setEditing] = useState(false);
  if (editing && section && onSave) {
    return (
      <SectionEditor
        section={section}
        onCancel={() => setEditing(false)}
        onSave={async (next) => {
          await onSave(next);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <>
      {section ? (
        <p className="ob-side-summary">
          {section.headline ?? clip(section.answer, 140)}
        </p>
      ) : null}
      {body}
      {section && section.findings.length > 0 ? (
        <ul className="ob-findings">
          {section.findings.map((finding) => (
            <li key={finding.point}>
              <span>{finding.point}</span>
              <span className="ob-tile-source">
                {EVIDENCE_LABELS[finding.evidence]}
                {finding.sourceUrl ? (
                  <>
                    {" · "}
                    <a
                      href={finding.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {sourceHost(finding.sourceUrl)}
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {section && onSave ? (
        <button
          type="button"
          className="button button-secondary button-small ob-edit"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      ) : null}
    </>
  );
}

interface SiteCardProps {
  overview: CmoOverview;
  host: string;
  /** Core is still capturing: what has not landed keeps its place. */
  pending?: boolean;
}

/** The homepage as visitors see it, with the brand's logo and colours. */
export function SiteCard({ overview, host, pending = false }: SiteCardProps) {
  const colors = (overview.brandVisual?.colors ?? []).slice(0, MAX_COLORS);
  return (
    <div className="card ob-sitecard">
      <h2>Your site</h2>
      <SiteShowcase media={overview.brandMedia} host={host} pending={pending} />
      <div className="ob-brandmark">
        <BusinessMark overview={overview} size={36} wide />
        {colors.length === 0 && pending ? (
          <ul className="ob-swatches" aria-hidden="true">
            {Array.from({ length: MAX_COLORS }, (_, swatch) => (
              // Placeholders have no identity beyond their place.
              <li key={swatch} className="ob-swatch-skeleton" />
            ))}
          </ul>
        ) : colors.length > 0 ? (
          <ul className="ob-swatches" aria-label="Brand colours">
            {colors.map((color) => (
              <li key={color} style={{ background: color }}>
                <span className="ob-sr">{color}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Where a tile's facts come from: its section's first sourced finding, else the site. */
export function tileSource(
  tile: TileData,
  profile: ReturnType<typeof brandProfile>,
  fallback: string,
): string {
  const section = tile.section ? profile[tile.section] : undefined;
  return (
    section?.findings?.find((finding) => finding.sourceUrl)?.sourceUrl ??
    fallback
  );
}

interface PromiseCardProps {
  brain: BrandBrain;
  site: string;
  onSave: (brain: BrandBrain) => Promise<void>;
}

/** The promise in one line, as Cuso read it, with the owner's edit. */
function PromiseCard({ brain, site, onSave }: PromiseCardProps) {
  const reveal = brain.reveal;
  const statement = reveal?.positioning ?? firstSentence(brain.summary);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(statement);
  const [failed, setFailed] = useState(false);
  return (
    <div className="card ob-promise">
      <div className="ob-promise-head">
        <h2>Your promise, in one line</h2>
        {editing ? null : (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setText(statement);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="ob-promise-form"
          action={async () => {
            const next = text.trim();
            if (!next) return;
            setFailed(false);
            try {
              await onSave(
                reveal?.positioning
                  ? { ...brain, reveal: { ...reveal, positioning: next } }
                  : { ...brain, summary: next },
              );
              setEditing(false);
            } catch {
              setFailed(true);
            }
          }}
        >
          <textarea
            className="ob-textarea"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Your promise, in one line"
          />
          <div className="ob-promise-actions">
            <SubmitButton className="button button-small">Save</SubmitButton>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          {failed ? (
            <p className="alert" role="alert">
              That didn't save. Try again.
            </p>
          ) : null}
        </form>
      ) : (
        <p className="ob-statement">{statement}</p>
      )}
      <p className="ob-tile-source">Source: {site}</p>
    </div>
  );
}
