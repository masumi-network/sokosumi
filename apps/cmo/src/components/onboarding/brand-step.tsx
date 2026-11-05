"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";

import {
  BRAND_SECTIONS,
  type BrandBrain,
  type BrandSectionKey,
  brandProfile,
  sourceHost,
} from "../../lib/brand-sections";
import type { CusoMessage } from "../../lib/chat-messages";
import {
  Accounts,
  AskForm,
  firstSentence,
  hostOf,
  Offers,
  SectionDetail,
  Voice,
} from "../brand-profile";
import { MarketingToday } from "../marketing-today";
import {
  AGENT_NAME,
  type Answer,
  CusoAvatar,
  QuestionCard,
  SidePanel,
  Tile,
  useAnswers,
} from "./parts";
import { Refusal } from "./refusal";

/** Longest one-line value or detail a tile shows. */
const CLIP = 72;

function clip(text: string, max = CLIP): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

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
function brandTiles(
  brain: BrandBrain,
  onSave: (brain: BrandBrain) => Promise<void>,
): TileData[] {
  const tiles: TileData[] = [];
  const offer = brain.offers?.[0];
  const sells = offer?.name ?? brain.products[0];
  if (sells) {
    tiles.push({
      id: "sell",
      label: "What you sell",
      value: clip(sells),
      detail: offer
        ? clip(`${offer.price}. ${offer.what}`)
        : clip(brain.products.slice(1).join(", ")),
      section: "offer",
      body: <Offers brain={brain} onSave={onSave} />,
    });
  }
  const buyer = brain.reveal?.buyers[0];
  const buys = buyer?.role ?? brain.audience[0];
  if (buys) {
    tiles.push({
      id: "buy",
      label: "Who buys",
      value: clip(buys),
      detail: buyer
        ? clip(`Wants: ${buyer.wants}`)
        : clip(brain.audience.slice(1).join(", ")),
      section: "customers",
    });
  }
  if (brain.voice.tone) {
    tiles.push({
      id: "voice",
      label: "Your voice",
      value: clip(firstSentence(brain.voice.tone)),
      detail: brain.voice.do[0] ? clip(brain.voice.do[0]) : undefined,
      section: "positioning",
      body: <Voice brain={brain} />,
    });
  }
  const today = brain.marketingToday;
  if (today) {
    tiles.push({
      id: "marketing",
      label: "Marketing today",
      value: clip(firstSentence(today.summary)),
      detail: today.channels?.length
        ? clip(today.channels.map((channel) => channel.name).join(", "))
        : undefined,
      section: "marketing",
      body: <MarketingToday today={today} />,
    });
  }
  const rivals = [...brain.competitors, ...(brain.alternatives ?? [])];
  if (rivals.length > 0) {
    const [first, ...rest] = rivals;
    tiles.push({
      id: "competitors",
      label: "Competitors",
      value: clip(first?.name ?? ""),
      detail: rest.length
        ? clip(rest.map((rival) => rival.name).join(", "))
        : undefined,
      section: "competition",
      body: (
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
      ),
    });
  }
  if (brain.channels.length > 0) {
    tiles.push({
      id: "profiles",
      label: "Profiles",
      value: `${brain.channels.length} ${brain.channels.length === 1 ? "profile" : "profiles"}`,
      detail: clip(brain.channels.map((channel) => channel.name).join(", ")),
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
  /** Approves the Brand Brain and asks for the plan; a refusal comes back as text. */
  onApprove: () => Promise<string | null>;
  onAnswer: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  /** Set when the founder opened this step again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
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
  const [stale, setStale] = useState(false);
  const idle = overview.botStatus !== "RUNNING";
  useEffect(() => {
    setStale(false);
    if (sent === null || answered) return;
    const timer = window.setTimeout(
      () => setStale(true),
      idle ? 30_000 : 240_000,
    );
    return () => window.clearTimeout(timer);
  }, [sent, answered, idle]);
  const fixing = sent !== null && !answered && !stale;
  // Right after research Cuso is still wrapping up his turn for a few seconds.
  const finishing = !fixing && !stale && overview.botStatus === "RUNNING";

  async function ask(text: string) {
    setSent({ text, after: lastWord?.id ?? null });
    try {
      await onCorrect(text);
    } catch (error) {
      setSent(null);
      throw error;
    }
  }

  const tiles = brandTiles(brain, onSave);
  const shown = tiles.find((tile) => tile.id === open);
  const section = shown?.section ? profile[shown.section] : undefined;

  const [questions, answer] = useAnswers(brain.questions ?? [], onAnswer);
  const left = questions.filter((question) => !question.answer);
  const openQuestion = questions.findIndex((question) => !question.answer);
  const current = questions[openQuestion];
  // A no waits for Cuso to rewrite its section; opened again after the plan,
  // the founder sends him to fix it instead of moving on.
  const corrections = questions.filter(
    (question) => question.answer === "no" && question.corrected === false,
  ).length;
  const lead = corrections > 0 ? undefined : ahead;
  const insights = brain.reveal?.insights ?? [];
  const busy = approving || fixing || finishing;

  return (
    <section className="ob-brand">
      <div className="ob-title-row">
        <CusoAvatar pose="thinking" size={48} />
        <div className="ob-title-copy">
          <h1 className="ob-h1">Here's {site} as I see it.</h1>
          <p className="ob-muted">
            {AGENT_NAME} · tap any tile to see the source or fix it
          </p>
        </div>
        <div className="ob-title-action">
          {lead ? (
            <button type="button" className="button" onClick={lead.onClick}>
              Continue to {lead.label}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
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
          )}
          {fixing ? (
            <p className="ob-small ob-muted">
              Updating your Brand Brain. About half a minute.
            </p>
          ) : stale && !answered ? (
            <p className="ob-small ob-muted">
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
          <PromiseCard brain={brain} site={site} onSave={onSave} />

          {left.length > 0 ? (
            <div className="card ob-left">
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
                {insights.map((insight) => (
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
          >
            {shown.body}
            {shown.section ? (
              <SectionDetail
                sectionKey={shown.section}
                section={section}
                onSave={async (next) => {
                  if (!shown.section) return;
                  await onSave({
                    ...brain,
                    profile: { ...profile, [shown.section]: next },
                  });
                  // The summary comes from Cuso, so he brings it in line.
                  await ask(
                    `I corrected the ${BRAND_SECTIONS[shown.section].title} research in my Brand Brain. Update the summary to match it.`,
                  );
                }}
                onAsk={ask}
              />
            ) : null}
            <AskForm
              key={shown.id}
              cta="Send"
              placeholder={`Tell ${AGENT_NAME} what's off`}
              onAsk={ask}
            />
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

/** Where a tile's facts come from: its section's first sourced finding, else the site. */
function tileSource(
  tile: TileData,
  profile: ReturnType<typeof brandProfile>,
  fallback: string,
): string {
  const section = tile.section ? profile[tile.section] : undefined;
  return (
    section?.findings.find((finding) => finding.sourceUrl)?.sourceUrl ??
    fallback
  );
}

/** The promise in one line, as Cuso read it, with the owner's edit. */
function PromiseCard({
  brain,
  site,
  onSave,
}: {
  brain: BrandBrain;
  site: string;
  onSave: (brain: BrandBrain) => Promise<void>;
}) {
  const reveal = brain.reveal;
  const statement = reveal?.positioning ?? firstSentence(brain.summary);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(statement);
  const [saving, startSaving] = useTransition();
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
          onSubmit={(event) => {
            event.preventDefault();
            const next = text.trim();
            if (!next) return;
            startSaving(async () => {
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
            });
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
            <button
              type="submit"
              className="button button-small"
              disabled={saving}
            >
              Save
            </button>
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
